import React, { useState, useEffect } from 'react';
import { ResearchProject, ResearchDraft, UploadedFile } from '../types';
import { PASTEL_THEMES } from '../constants';
import { storageService } from '../services/storageService';
import { computeSourceCount, computeAssetCount } from '../services/statsService';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { SubscriptionModal } from './SubscriptionModal';
import { useSubscription } from '../hooks/useSubscription';
import { uploadFileToGemini, generateMagicProjectPlan, generateDraftResearchTopicsAlt, generateSeoSeedKeywords } from '../services/geminiService';
import { classifyProjectAgent, ProjectAgent } from '../services/agentClassifyService';
import { HomeLiveAssistant } from './HomeLiveAssistant';
import { authFetch } from '../services/authFetch';
import { useCredits } from '../hooks/useCredits';
import { LiveAssistantButton } from './LiveAssistantButton';
import { CreditBalanceDisplay } from './InsufficientCreditsModal';
import { CreditInfoModal } from './CreditInfoModal';
import { OnboardingTutorial, useShouldShowTutorial, TutorialStep } from './OnboardingTutorial';
import { useSocialConnections } from '../hooks/useSocialConnections';
import { fetchSuggestions } from '../services/autocompleteService';

interface ProjectsPageProps {
  onSelectProject: (project: ResearchProject, options?: { initialTab?: any; initialAssetType?: string; view?: 'dashboard' | 'research' }) => void;
  onOpenAgentDeploy?: (project: ResearchProject) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  projectsVersion?: number;
  isActive?: boolean; // Controls if this page is the active view (for portal-based buttons)
}

export const ProjectsPage: React.FC<ProjectsPageProps> = ({ onSelectProject, onOpenAgentDeploy, isDarkMode, toggleTheme, projectsVersion, isActive = true }) => {
  const social = useSocialConnections();
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [magicPrompt, setMagicPrompt] = useState('');
  const [magicCreating, setMagicCreating] = useState(false);
  const [magicError, setMagicError] = useState('');
  const [showHomeAssistant, setShowHomeAssistant] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<Array<{
    id: string;
    scheduledAt: number;
    platforms: string[];
    textContent: string;
    status: string;
    projectId?: string;
  }>>([]);

  const {
    isSubscribed,
    subscription,
    showUpgradeModal,
    upgradeModalTrigger,
    initialTier,
    openUpgradeModal,
    closeUpgradeModal
  } = useSubscription();

  const [showCreditInfo, setShowCreditInfo] = useState(false);
  const { credits } = useCredits();

  // Onboarding tutorial state
  const shouldShowTutorial = useShouldShowTutorial('freshfront-projects-onboarding');
  const [showTutorial, setShowTutorial] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Prompt Container State
  const [promptText, setPromptText] = useState('');
  const [promptAttachments, setPromptAttachments] = useState<Array<{ id: string; file: File; status: 'uploading' | 'ready' | 'error'; uploaded?: UploadedFile; previewUrl?: string }>>([]);
  const promptAttachInputRef = React.useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const speechRecognitionRef = React.useRef<any>(null);

  // Autocomplete State
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

  // Home Assistant initial data
  const [homeAssistantInitialMessage, setHomeAssistantInitialMessage] = useState<string | undefined>();
  const [homeAssistantInitialAttachments, setHomeAssistantInitialAttachments] = useState<Array<{ file: File; uploaded: UploadedFile }> | undefined>();

  // Tutorial steps configuration
  const tutorialSteps: TutorialStep[] = [
    {
      id: 'profile',
      targetSelector: '#onboarding-profile-btn',
      title: 'Set up your profile',
      description: 'Add your brand logo and description to give the AI better context about you and your business.',
      position: 'bottom',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.118a7.5 7.5 0 0115 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.5-1.632z" />
        </svg>
      ),
    },
    {
      id: 'magic-research',
      targetSelector: '#onboarding-magic-research',
      title: 'Start with AI research',
      description: 'Describe what you want to research and we\'ll create a complete project with notes, tasks, and draft research topics.',
      position: 'top',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      id: 'create-project',
      targetSelector: '#onboarding-create-project',
      title: 'Or start from scratch',
      description: 'Create a blank project and build it yourself. Add files, notes, tasks, and run research as you go.',
      position: 'bottom',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v16m8-8H4" />
        </svg>
      ),
    },
  ];

  // Show tutorial after initial load if user is new
  useEffect(() => {
    // Double-check localStorage to prevent reappearing after navigation
    const isCompleted = localStorage.getItem('freshfront-projects-onboarding') === 'true';
    if (shouldShowTutorial && !isCompleted && !loading && projects.length === 0) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => setShowTutorial(true), 500);
      return () => clearTimeout(timer);
    }
  }, [shouldShowTutorial, loading, projects.length]);

  // Global search state
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    files: Array<{ projectId: string; projectName: string; file: any }>;
    notes: Array<{ projectId: string; projectName: string; note: any }>;
    tasks: Array<{ projectId: string; projectName: string; task: any }>;
    assets: Array<{ projectId: string; projectName: string; asset: any; type: string }>;
  }>({ files: [], notes: [], tasks: [], assets: [] });

  useEffect(() => {
    loadProjects();
  }, [projectsVersion]);

  // Autocomplete debounced fetch
  useEffect(() => {
    const trimmed = promptText.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsFetchingSuggestions(true);
      try {
        const results = await fetchSuggestions(trimmed);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        setSuggestionIndex(-1);
      } finally {
        setIsFetchingSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [promptText]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const loadedProjects = await storageService.getResearchProjects(true);
      setProjects(loadedProjects);

      // Fetch scheduled posts for all projects
      try {
        const postsRes = await authFetch('/api/social?op=schedule-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: auth.currentUser?.uid
          }),
        });
        if (postsRes.ok) {
          const data = await postsRes.json();
          setScheduledPosts(data.posts || []);
        }
      } catch (e) {
        console.warn('Failed to load scheduled posts:', e);
      }
    } catch (e) {
      console.error('Failed to load projects:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleMagicCreateProject = async () => {
    const trimmedPrompt = magicPrompt.trim();
    if (!trimmedPrompt || magicCreating) return;

    setMagicCreating(true);
    setMagicError('');

    try {
      const plan = await generateMagicProjectPlan(trimmedPrompt);

      // Normalize and ensure AI-generated metadata doesn't just mirror the raw prompt.
      let rawName = (plan.projectName || '').trim();
      let rawDescription = (plan.projectDescription || '').trim();

      if (!rawName) rawName = trimmedPrompt;
      if (!rawDescription) rawDescription = trimmedPrompt;

      const safeName =
        rawName === trimmedPrompt
          ? `${trimmedPrompt} – Research Project`
          : rawName.slice(0, 120);

      const safeDescription =
        rawDescription === trimmedPrompt
          ? `Deep research project exploring: ${trimmedPrompt}`
          : rawDescription;

      let seoSeedKeywords: string[] = [];
      let agent: ProjectAgent | undefined;
      try {
        [seoSeedKeywords, agent] = await Promise.all([
          generateSeoSeedKeywords(safeName, safeDescription, 5).catch(e => { console.error('Failed to generate SEO seed keywords for magic project:', e); return [] as string[]; }),
          classifyProjectAgent(safeName, safeDescription).catch(e => { console.error('Failed to classify project agent:', e); return undefined; }),
        ]);
      } catch (e) {
        console.error('Failed during magic project setup:', e);
      }

      const baseProject = await storageService.createResearchProject(
        safeName,
        safeDescription,
        { seoSeedKeywords, agent }
      );

      // Seed initial news (best-effort) to show in the project dashboard.
      try {
        const res = await authFetch('/api/news-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: 'everything',
            q: `${safeName} OR ${trimmedPrompt}`,
            sortBy: 'publishedAt',
            language: 'en',
            pageSize: 8,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const articles = Array.isArray(data?.articles) ? data.articles : [];

          await storageService.updateResearchProject(baseProject.id, {
            newsArticles: articles
              .filter((a: any) => a?.url)
              .slice(0, 8)
              .map((a: any) => ({
                source: a?.source ?? null,
                title: a?.title ?? '',
                description: a?.description ?? null,
                url: a?.url ?? '',
                urlToImage: a?.urlToImage ?? null,
                publishedAt: a?.publishedAt ?? null,
              })),
            newsLastFetchedAt: Date.now(),
          });
        }
      } catch (e) {
        console.error('Failed to fetch initial news for magic project', e);
      }

      // Seed tasks
      const MIN_TASKS = 4;
      let tasksAdded = 0;
      if (plan.tasks && plan.tasks.length > 0) {
        for (const t of plan.tasks) {
          try {
            await storageService.addTask(baseProject.id, {
              title: t.title,
              description: t.description,
              status: 'todo',
              priority: t.priority,
              aiGenerated: true,
              sourceResearchId: undefined,
              tags: []
            });
            tasksAdded++;
          } catch (e) {
            console.error('Failed to add AI task', e);
          }
        }
      }

      if (tasksAdded < MIN_TASKS) {
        const remainingTasks = MIN_TASKS - tasksAdded;
        const draftTopicsForTasks = Array.isArray(plan.researchDraftTopics)
          ? plan.researchDraftTopics
            .map(t => (t ? String(t).trim() : ''))
            .filter(t => t.length > 0)
          : [];
        for (let i = 0; i < remainingTasks; i++) {
          try {
            const topicForTask =
              draftTopicsForTasks.length > 0
                ? draftTopicsForTasks[(tasksAdded + i) % draftTopicsForTasks.length]
                : trimmedPrompt || safeName;

            await storageService.addTask(baseProject.id, {
              title:
                draftTopicsForTasks.length > 0
                  ? `Deep dive: ${topicForTask}`
                  : i === 0
                    ? 'Clarify project goals'
                    : i === 1
                      ? 'Identify key research questions'
                      : `AI kickoff task ${i + 1}`,
              description:
                draftTopicsForTasks.length > 0
                  ? `Investigate "${topicForTask}" in the context of "${safeName}". Use this task to gather sources, map key stakeholders, and surface open questions specific to this angle.`
                  : `AI-suggested task to help get started on "${safeName}".`,
              status: 'todo',
              priority: 'medium',
              aiGenerated: true,
              sourceResearchId: undefined,
              tags: []
            });
          } catch (e) {
            console.error('Failed to add fallback AI task', e);
          }
        }
      }

      // Seed notes
      const MIN_NOTES = 5;
      let notesAdded = 0;
      if (plan.initialNotes && plan.initialNotes.length > 0) {
        for (const n of plan.initialNotes) {
          try {
            await storageService.addNote(baseProject.id, {
              title: n.title,
              content: n.content,
              color: undefined,
              pinned: false,
              aiGenerated: true,
              aiSuggestions: [],
              tags: [],
              linkedResearchId: undefined
            });
            notesAdded++;
          } catch (e) {
            console.error('Failed to add AI note', e);
          }
        }
      }

      if (notesAdded < MIN_NOTES) {
        const remainingNotes = MIN_NOTES - notesAdded;
        const baseContext =
          (safeDescription || trimmedPrompt) +
          (plan.researchDraftTopics && plan.researchDraftTopics.length
            ? `\n\nDraft focus areas to explore:\n- ${plan.researchDraftTopics
              .map(t => (t ? String(t).trim() : ''))
              .filter(t => t.length > 0)
              .slice(0, 5)
              .join('\n- ')}`
            : '');
        for (let i = 0; i < remainingNotes; i++) {
          const index = i + 1;
          try {
            await storageService.addNote(baseProject.id, {
              title:
                index === 1
                  ? 'Project overview'
                  : index === 2
                    ? 'Key outcomes to aim for'
                    : index === 3
                      ? 'Initial assumptions and hypotheses'
                      : index === 4
                        ? 'Open questions and unknowns'
                        : `AI kickoff note ${index}`,
              content:
                baseContext ||
                `AI-generated note to help you get started on this magic research project.`,
              color: undefined,
              pinned: false,
              aiGenerated: true,
              aiSuggestions: [],
              tags: [],
              linkedResearchId: undefined
            });
          } catch (e) {
            console.error('Failed to add fallback AI note', e);
          }
        }
      }

      // Seed draft research sessions: ensure we have a solid backlog of topics.
      let drafts: ResearchDraft[] = [];
      try {
        let draftTopics: string[] = Array.isArray(plan.researchDraftTopics)
          ? plan.researchDraftTopics
            .map(t => (t ? String(t).trim() : ''))
            .filter(t => t.length > 0)
          : [];

        // If the plan didn't return enough topics (or we hit fallback),
        // top up using the lightweight background draft generator.
        if (draftTopics.length < 8) {
          try {
            const extraTopics = await generateDraftResearchTopicsAlt(
              safeName,
              safeDescription,
              draftTopics
            );
            draftTopics = [...draftTopics, ...extraTopics].slice(0, 8);
          } catch (extraErr) {
            console.error('Failed to generate extra draft topics for magic project', extraErr);
          }
        }

        // Absolute fallback: if everything failed, at least keep the original idea as one draft.
        if (draftTopics.length === 0 && trimmedPrompt) {
          draftTopics = [trimmedPrompt];
        }

        if (draftTopics.length > 0) {
          const now = Date.now();
          drafts = draftTopics.map((topic, index) => ({
            id:
              typeof crypto !== 'undefined' && (crypto as any).randomUUID
                ? crypto.randomUUID()
                : `${now}-${index}-${Math.random().toString(36).slice(2)}`,
            topic,
            createdAt: now + index,
          }));

          try {
            await storageService.updateResearchProject(baseProject.id, {
              draftResearchSessions: drafts,
            });
          } catch (e) {
            console.error('Failed to persist draft research sessions', e);
          }
        }
      } catch (draftErr) {
        console.error('Failed to prepare draft research sessions for magic project', draftErr);
      }

      // Hydrate the project with latest data (including drafts)
      const hydrated = await storageService.getResearchProject(baseProject.id) || {
        ...baseProject,
        draftResearchSessions: drafts
      };

      setProjects(prev => {
        const without = prev.filter(p => p.id !== hydrated.id);
        return [hydrated, ...without];
      });
      setMagicPrompt('');

      // Open the new project dashboard. Drafts will be visible but won't auto-execute.
      onSelectProject(hydrated);
    } catch (e) {
      console.error('Failed to create magic project:', e);
      setMagicError('Failed to create project. Please try again.');
    } finally {
      setMagicCreating(false);
    }
  };

  const handleCreateProject = async (targetView: 'dashboard' | 'research' = 'dashboard') => {
    // If called via event (e.g. form submit or click without args), targetView might be an event object.
    // Ensure we have a valid view string, defaulting to dashboard.
    const view = (typeof targetView === 'string' && (targetView === 'research' || targetView === 'dashboard'))
      ? targetView
      : 'dashboard';

    if (!newProjectName.trim()) return;

    setCreating(true);
    try {
      const trimmedName = newProjectName.trim();
      const trimmedDescription = newProjectDescription.trim();

      let seoSeedKeywords: string[] = [];
      let agent: ProjectAgent | undefined;
      try {
        [seoSeedKeywords, agent] = await Promise.all([
          generateSeoSeedKeywords(trimmedName, trimmedDescription, 5).catch(e => { console.error('Failed to generate SEO seed keywords for manual project:', e); return [] as string[]; }),
          classifyProjectAgent(trimmedName, trimmedDescription).catch(e => { console.error('Failed to classify project agent:', e); return undefined; }),
        ]);
      } catch (e) {
        console.error('Failed during project setup:', e);
      }

      const newProject = await storageService.createResearchProject(
        trimmedName,
        trimmedDescription,
        { seoSeedKeywords, agent }
      );
      setProjects(prev => {
        const without = prev.filter(p => p.id !== newProject.id);
        return [newProject, ...without];
      });
      setShowCreateModal(false);
      setNewProjectName('');
      setNewProjectDescription('');
      onSelectProject(newProject, { view });
    } catch (e) {
      console.error('Failed to create project:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project and all its research?')) return;

    try {
      await storageService.deleteResearchProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (e) {
      console.error('Failed to delete project:', e);
    }
  };

  const handleDuplicateProject = async (e: React.MouseEvent, project: ResearchProject) => {
    e.stopPropagation();

    try {
      const duplicated = await storageService.duplicateResearchProject(project.id);
      setProjects(prev => [duplicated, ...prev]);
    } catch (error) {
      console.error('Failed to duplicate project:', error);
    }
  };

  const performSearch = (query: string) => {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) {
      setSearchResults({ files: [], notes: [], tasks: [], assets: [] });
      return;
    }

    const results = {
      files: [] as Array<{ projectId: string; projectName: string; file: any }>,
      notes: [] as Array<{ projectId: string; projectName: string; note: any }>,
      tasks: [] as Array<{ projectId: string; projectName: string; task: any }>,
      assets: [] as Array<{ projectId: string; projectName: string; asset: any; type: string }>
    };

    projects.forEach(project => {
      // Search files
      const files = project.uploadedFiles || [];
      files.forEach(file => {
        const nameMatch = (file.displayName || '').toLowerCase().includes(trimmedQuery);
        const summaryMatch = (file.summary || '').toLowerCase().includes(trimmedQuery);
        if (nameMatch || summaryMatch) {
          results.files.push({ projectId: project.id, projectName: project.name, file });
        }
      });

      // Search notes
      const notes = project.notes || [];
      notes.forEach(note => {
        const titleMatch = (note.title || '').toLowerCase().includes(trimmedQuery);
        const contentMatch = (note.content || '').toLowerCase().includes(trimmedQuery);
        if (titleMatch || contentMatch) {
          results.notes.push({ projectId: project.id, projectName: project.name, note });
        }
      });

      // Search tasks
      const tasks = project.tasks || [];
      tasks.forEach(task => {
        const titleMatch = (task.title || '').toLowerCase().includes(trimmedQuery);
        const descMatch = (task.description || '').toLowerCase().includes(trimmedQuery);
        if (titleMatch || descMatch) {
          results.tasks.push({ projectId: project.id, projectName: project.name, task });
        }
      });

      // Search assets (images, videos, blogs, podcasts)
      const sessions = project.researchSessions || [];
      sessions.forEach(session => {
        const report = session.researchReport;
        if (!report) return;

        // Note: Images search commented out due to type incompatibility
        // Uncomment if images property is added to ResearchReport type
        /*
        // Images
        const images = report.images || [];
        images.forEach(img => {
          const altMatch = (img.alt || '').toLowerCase().includes(trimmedQuery);
          const titleMatch = (img.title || '').toLowerCase().includes(trimmedQuery);
          if (altMatch || titleMatch) {
            results.assets.push({
              projectId: project.id,
              projectName: project.name,
              asset: img,
              type: 'image'
            });
          }
        });
        */

        // Videos
        const videos = report.youtubeVideos || [];
        videos.forEach(video => {
          const titleMatch = (video.title || '').toLowerCase().includes(trimmedQuery);
          const channelMatch = (video.channel || '').toLowerCase().includes(trimmedQuery);
          if (titleMatch || channelMatch) {
            results.assets.push({
              projectId: project.id,
              projectName: project.name,
              asset: video,
              type: 'video'
            });
          }
        });

        // Blogs
        if (report.blogPost) {
          const blog = report.blogPost;
          const titleMatch = (blog.title || '').toLowerCase().includes(trimmedQuery);
          const contentMatch = (blog.content || '').toLowerCase().includes(trimmedQuery);
          if (titleMatch || contentMatch) {
            results.assets.push({
              projectId: project.id,
              projectName: project.name,
              asset: blog,
              type: 'blog'
            });
          }
        }
      });

      // Search knowledge base files (another type of file/asset)
      const kbFiles = project.knowledgeBase || [];
      kbFiles.forEach(kbFile => {
        const nameMatch = (kbFile.name || '').toLowerCase().includes(trimmedQuery);
        const summaryMatch = (kbFile.summary || '').toLowerCase().includes(trimmedQuery);
        if (nameMatch || summaryMatch) {
          results.files.push({
            projectId: project.id,
            projectName: project.name,
            file: { ...kbFile, displayName: kbFile.name, mimeType: kbFile.type }
          });
        }
      });
    });

    setSearchResults(results);
    setShowSearchModal(true);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Sign out failed:', e);
    }
  };

  const goToProfile = () => {
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', '/profile');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isUploadingPromptAttachments = promptAttachments.some(a => a.status === 'uploading');

  const handlePromptFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments = Array.from(files).map(file => {
      const isImage = file.type.startsWith('image/');
      return {
        id: crypto.randomUUID(),
        file,
        status: 'uploading' as const,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined
      };
    });

    setPromptAttachments(prev => [...prev, ...newAttachments]);
    if (promptAttachInputRef.current) promptAttachInputRef.current.value = '';

    for (const att of newAttachments) {
      try {
        const uploaded = await uploadFileToGemini(att.file);
        setPromptAttachments(prev => prev.map(a => a.id === att.id ? { ...a, status: 'ready', uploaded } : a));
      } catch (err) {
        console.error('Failed to upload attachment:', err);
        setPromptAttachments(prev => prev.map(a => a.id === att.id ? { ...a, status: 'error' } : a));
      }
    }
  };

  const removePromptAttachment = (id: string) => {
    setPromptAttachments(prev => {
      const filtered = prev.filter(a => a.id !== id);
      prev.forEach(a => { if (a.id === id && a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
      return filtered;
    });
  };

  const togglePromptRecording = () => {
    if (isRecording) {
      if (speechRecognitionRef.current) speechRecognitionRef.current.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let currentTranscript = promptText;
    if (currentTranscript && !currentTranscript.endsWith(' ')) currentTranscript += ' ';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      if (final) currentTranscript += final + ' ';
      setPromptText(currentTranscript + interim);
    };

    recognition.onerror = (e: any) => {
      console.error('Speech recognition error', e);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
    speechRecognitionRef.current = recognition;
    setIsRecording(true);
  };

  const handlePromptSubmit = () => {
    if (!promptText.trim() && promptAttachments.length === 0) return;
    if (isUploadingPromptAttachments) return;

    if (isRecording && speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      setIsRecording(false);
    }

    const readyAttachments = promptAttachments
      .filter(a => a.status === 'ready' && a.uploaded)
      .map(a => ({ file: a.file, uploaded: a.uploaded! }));

    setHomeAssistantInitialMessage(promptText.trim());
    if (readyAttachments.length > 0) {
      setHomeAssistantInitialAttachments(readyAttachments);
    } else {
      setHomeAssistantInitialAttachments(undefined);
    }
    
    setShowHomeAssistant(true);
    setPromptText('');
    setPromptAttachments([]);
  };


  return (
    <div className={isDarkMode ? 'min-h-screen h-screen overflow-y-auto bg-[#000000] text-white' : 'min-h-screen h-screen overflow-y-auto bg-gray-50 text-gray-900'}>
      {/* Subtle background gradient */}
      <div className="fixed inset-0 pointer-events-none">
        {isDarkMode ? (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-to-b from-[#0071e3]/5 via-transparent to-transparent blur-3xl"></div>
        ) : (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-to-b from-blue-200/40 via-transparent to-transparent blur-3xl"></div>
        )}
      </div>

      {showHomeAssistant && (
        <HomeLiveAssistant
          projects={projects}
          scheduledPosts={scheduledPosts}
          isDarkMode={isDarkMode}
          onClose={() => {
            setShowHomeAssistant(false);
            setHomeAssistantInitialMessage(undefined);
            setHomeAssistantInitialAttachments(undefined);
          }}
          social={social}
          initialMessage={homeAssistantInitialMessage}
          initialAttachments={homeAssistantInitialAttachments}
        />
      )}

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
        {/* Top Utility Bar */}
        <div className="flex items-center gap-3 w-full justify-end mb-12">
          <CreditBalanceDisplay
            credits={credits}
            isDarkMode={isDarkMode}
            onClick={() => setShowCreditInfo(true)}
          />
          {!isSubscribed && (
            <button
              onClick={() => openUpgradeModal('button', 'pro')}
              className="flex-initial flex items-center justify-center gap-2 bg-[#0071e3] hover:bg-[#0077ed] text-white px-5 sm:px-6 py-3 rounded-full font-medium text-[15px] transition-all duration-200 active:scale-[0.98] shadow-md shadow-[#0071e3]/25"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              <span className="hidden sm:inline">Subscribe to Pro</span>
              <span className="sm:hidden">Pro</span>
            </button>
          )}

          {/* Unlimited Badge */}
          {isSubscribed && (subscription?.unlimited || subscription?.subscriptionTier === 'unlimited') && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
              <span className="text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Unlimited</span>
              <span className="text-lg leading-none text-purple-500">∞</span>
            </div>
          )}

          {/* Pro User -> Get Unlimited Button */}
          {isSubscribed && !(subscription?.unlimited || subscription?.subscriptionTier === 'unlimited') && (
            <button
              onClick={() => openUpgradeModal('button', 'unlimited')}
              className="flex-initial flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 text-white px-5 sm:px-6 py-3 rounded-full font-medium text-[15px] transition-all duration-200 active:scale-[0.98] shadow-md shadow-purple-500/25"
            >
              <span className="sm:hidden">Upgrade</span>
              <span className="hidden sm:inline">Get Unlimited</span>
              <span className="hidden sm:inline text-lg leading-none">∞</span>
            </button>
          )}
          <button
            onClick={toggleTheme}
            className={
              "w-10 h-10 flex items-center justify-center rounded-full border transition-all duration-200 " +
              (isDarkMode
                ? "border-[#3a3a3c] text-[#86868b] hover:text-white hover:bg-white/5"
                : "border-gray-200 text-gray-500 hover:text-[#0071e3] hover:bg-blue-50")
            }
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25M18.364 5.636l-1.591 1.591M21 12h-2.25M18.364 18.364l-1.591-1.591M12 18.75V21M7.227 16.773l-1.591 1.591M5.25 12H3M7.227 7.227L5.636 5.636M12 8.25A3.75 3.75 0 1015.75 12 3.75 3.75 0 0012 8.25z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0118 15.75 9.75 9.75 0 018.25 6a9.72 9.72 0 01.748-3.752A9.753 9.753 0 003 11.25C3 16.634 7.366 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
          </button>
          <div className="relative">
            <button
              id="onboarding-profile-btn"
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className={
                "w-10 h-10 flex items-center justify-center rounded-full border transition-all duration-200 " +
                (isDarkMode
                  ? "border-white/10 text-gray-400 hover:text-white hover:bg-white/5"
                  : "border-gray-200 text-gray-500 hover:text-ocean-500 hover:bg-ocean-50")
              }
              title="Profile"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.118a7.5 7.5 0 0115 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.5-1.632z" />
              </svg>
            </button>

            {/* Profile Dropdown */}
            {showProfileMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                <div className={`absolute right-0 top-full mt-2 w-48 rounded-xl border shadow-lg overflow-hidden z-50 animate-scale-in origin-top-right ${isDarkMode ? 'bg-[#1c1c1e] border-[#3a3a3c]' : 'bg-white border-gray-200'
                  }`}>
                  <button
                    onClick={() => {
                      goToProfile();
                      setShowProfileMenu(false);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${isDarkMode ? 'text-white hover:bg-[#3a3a3c]' : 'text-gray-900 hover:bg-gray-50'
                      }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Settings
                  </button>

                  {auth.currentUser?.email === 'contact.mngrm@gmail.com' && (
                    <button
                      onClick={() => {
                        window.history.pushState({}, '', '/admin');
                        window.dispatchEvent(new PopStateEvent('popstate'));
                        setShowProfileMenu(false);
                      }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${isDarkMode ? 'text-blue-400 hover:bg-[#3a3a3c]' : 'text-blue-600 hover:bg-blue-50'
                        }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Admin Portal
                    </button>
                  )}

                  <div className={`border-t ${isDarkMode ? 'border-[#3a3a3c]' : 'border-gray-100'}`} />
                  <button
                    onClick={() => {
                      handleSignOut();
                      setShowProfileMenu(false);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${isDarkMode ? 'text-red-400 hover:bg-[#3a3a3c]' : 'text-red-600 hover:bg-red-50'
                      }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mb-8 text-center">
          <h2
            className={`text-2xl sm:text-3xl lg:text-4xl font-light tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
            style={{ fontFamily: '"Space Grotesk", "Inter", sans-serif' }}
          >
            What do you want to do today?
          </h2>
        </div>

        {/* --- Prompt Container (Floating/Premium Style) --- */}
        <div className={`mb-12 w-full max-w-3xl mx-auto rounded-3xl border shadow-2xl transition-all duration-300 magic-research-glow ${isDarkMode ? 'bg-[#1c1c1e]/90 border-[#3a3a3c] shadow-black/40' : 'bg-white/90 border-gray-200 shadow-slate-900/10'} backdrop-blur-xl relative overflow-hidden flex flex-col`}>
          <div className="flex items-start gap-2 p-3 sm:p-4">
            <textarea
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (showSuggestions && suggestionIndex >= 0) {
                    e.preventDefault();
                    setPromptText(suggestions[suggestionIndex]);
                    setShowSuggestions(false);
                    setSuggestionIndex(-1);
                  } else {
                    e.preventDefault();
                    handlePromptSubmit();
                  }
                } else if (e.key === 'ArrowDown' && showSuggestions) {
                  e.preventDefault();
                  setSuggestionIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
                } else if (e.key === 'ArrowUp' && showSuggestions) {
                  e.preventDefault();
                  setSuggestionIndex(prev => (prev > 0 ? prev - 1 : -1));
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false);
                  setSuggestionIndex(-1);
                }
              }}
              placeholder="Ask anything, hit the mic, or upload a file..."
              className={`flex-1 bg-transparent resize-none outline-none py-2.5 px-3 text-[15px] sm:text-base min-h-[44px] leading-relaxed transition-colors ${isDarkMode ? 'text-white placeholder:text-gray-500' : 'text-gray-900 placeholder:text-gray-400'}`}
              rows={1}
              style={{ height: 'auto' }}
              onInput={e => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 300) + 'px';
              }}
            />
          </div>

          {/* Autocomplete Suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <>
              <div 
                className="fixed inset-0 z-[90]" 
                onClick={() => {
                  setShowSuggestions(false);
                  setSuggestionIndex(-1);
                }} 
              />
              <div className={`absolute top-full left-0 right-0 z-[100] mt-1 overflow-hidden rounded-2xl border shadow-2xl animate-scale-in origin-top ${isDarkMode ? 'bg-[#1c1c1e] border-[#3a3a3c]' : 'bg-white border-gray-200'}`}>
              <div className="py-1">
                {suggestions.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setPromptText(item);
                      setShowSuggestions(false);
                      setSuggestionIndex(-1);
                    }}
                    onMouseEnter={() => setSuggestionIndex(idx)}
                    className={`w-full text-left px-5 py-2.5 text-[14px] sm:text-base transition-colors flex items-center gap-3 ${
                      suggestionIndex === idx
                        ? isDarkMode ? 'bg-[#3a3a3c] text-white' : 'bg-blue-50 text-[#0071e3]'
                        : isDarkMode ? 'text-gray-300 hover:bg-[#2c2c2e]' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <svg className={`w-4 h-4 flex-shrink-0 ${suggestionIndex === idx ? (isDarkMode ? 'text-[#0a84ff]' : 'text-[#0071e3]') : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="truncate">{item}</span>
                    {suggestionIndex === idx && (
                      <span className={`ml-auto text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border ${isDarkMode ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-blue-100/50 border-blue-200 text-blue-600'}`}>Enter</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

          {promptAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-5 py-2">
              {promptAttachments.map(att => (
                <div key={att.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${isDarkMode ? 'bg-[#2c2c2e] border-[#3a3a3c] text-white' : 'bg-gray-100 border-gray-200 text-gray-800'}`}>
                  {att.previewUrl ? (
                    <img src={att.previewUrl} alt="" className="w-4 h-4 rounded object-cover" />
                  ) : (
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  )}
                  <span className="truncate max-w-[100px] sm:max-w-[150px]">{att.file.name}</span>
                  {att.status === 'uploading' ? (
                    <span className="w-3 h-3 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin ml-1" />
                  ) : att.status === 'error' ? (
                    <span className="text-red-500 ml-1">Failed</span>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-green-500 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  )}
                  <button onClick={() => removePromptAttachment(att.id)} className="ml-1 hover:text-red-500 hover:bg-red-500/10 rounded-full p-0.5 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={`px-4 py-3 flex items-center justify-between border-t ${isDarkMode ? 'border-[#2c2c2e]' : 'border-gray-100'}`}>
            <div className="flex items-center gap-1 sm:gap-2">
              <input
                type="file"
                multiple
                ref={promptAttachInputRef}
                onChange={handlePromptFileSelect}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,.mp3,.mp4,.wav,.m4a,.ogg,.jpg,.jpeg,.png,.gif,.webp,.svg,image/*,video/*,audio/*"
              />
              <button
                onClick={() => promptAttachInputRef.current?.click()}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-[#2c2c2e]' : 'text-gray-400 hover:text-[#0071e3] hover:bg-blue-50'}`}
                title="Attach Files"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
              </button>

              <button
                onClick={togglePromptRecording}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors ${isRecording ? 'text-red-500 bg-red-50 hover:bg-red-100 dark:bg-red-500/20 dark:hover:bg-red-500/30' : isDarkMode ? 'text-gray-400 hover:text-white hover:bg-[#2c2c2e]' : 'text-gray-400 hover:text-[#0071e3] hover:bg-blue-50'}`}
                title={isRecording ? "Stop Recording" : "Voice Input"}
              >
                {isRecording ? (
                  <svg className="w-5 h-5 animate-pulse" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 002 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 002 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                )}
              </button>
            </div>

            <button
              onClick={handlePromptSubmit}
              disabled={(!promptText.trim() && promptAttachments.length === 0) || isUploadingPromptAttachments}
              className={`flex items-center gap-2 px-5 py-2 sm:py-2.5 rounded-full font-medium text-[14px] transition-all duration-200 ${(promptText.trim() || promptAttachments.length > 0) && !isUploadingPromptAttachments
                ? isDarkMode ? 'bg-white text-black hover:opacity-90 active:scale-[0.98]' : 'bg-[#0071e3] text-white hover:bg-[#0077ed] active:scale-[0.98]'
                : 'bg-[#004e9a]/20 dark:bg-[#004e9a]/30 text-gray-400 dark:text-gray-500 cursor-not-allowed'}`}
            >
              Go
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
        <header className="flex flex-col sm:flex-row justify-start items-center gap-4 mb-10 sm:mb-14">

          {/* Global search input */}
          {projects.length > 0 && (
            <div className="relative w-full max-w-md">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  performSearch(e.target.value);
                }}
                placeholder="Search across all projects..."
                className={`w-full pl-10 pr-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${isDarkMode
                  ? 'bg-[#1d1d1f] border-[#3d3d3f] text-white placeholder:text-gray-500 focus:border-[#0a84ff]'
                  : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 shadow-sm'
                  }`}
              />
              <svg
                className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>

              {/* Global Search Dropdown */}
              {showSearchModal && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSearchModal(false)} />
                  <div className={`absolute top-full left-0 z-50 mt-2 w-[90vw] sm:w-[500px] md:w-[600px] max-h-[60vh] sm:max-h-[600px] overflow-hidden rounded-xl border shadow-2xl flex flex-col animate-scale-in origin-top-left ${isDarkMode ? 'bg-[#1c1c1e] border-[#3a3a3c]' : 'bg-white border-gray-200'}`}>
                    {/* Header */}
                    <div className={`px-4 py-3 border-b ${isDarkMode ? 'border-[#3a3a3c]' : 'border-gray-200'} flex items-center justify-between`}>
                      <span className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                        Found {searchResults.files.length + searchResults.notes.length + searchResults.tasks.length + searchResults.assets.length} results
                      </span>
                    </div>

                    {/* Results */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                      {searchResults.files.length === 0 && searchResults.notes.length === 0 && searchResults.tasks.length === 0 && searchResults.assets.length === 0 ? (
                        <div className="text-center py-8">
                          <svg className={`w-8 h-8 mx-auto mb-3 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <p className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>No results found</p>
                        </div>
                      ) : (
                        <>
                          {/* Files */}
                          {searchResults.files.length > 0 && (
                            <div>
                              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                Files ({searchResults.files.length})
                              </h3>
                              <div className="space-y-1">
                                {searchResults.files.map((result, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => {
                                      const project = projects.find(p => p.id === result.projectId);
                                      if (project) {
                                        setShowSearchModal(false);
                                        setSearchQuery('');
                                        onSelectProject(project, { initialTab: 'data' });
                                      }
                                    }}
                                    className={`w-full text-left p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#3a3a3c]' : 'hover:bg-gray-100'}`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <div className="flex-shrink-0 w-8 h-8 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800 border dark:border-gray-700 flex items-center justify-center">
                                        {result.file.url && result.file.mimeType?.startsWith('image/') ? (
                                          <img src={result.file.url} alt={result.file.displayName} className="w-full h-full object-cover" />
                                        ) : result.file.url && result.file.mimeType?.startsWith('video/') ? (
                                          <video src={result.file.url} className="w-full h-full object-cover" muted />
                                        ) : (
                                          <span className="text-sm">{result.file.mimeType?.includes('pdf') ? '📄' : '📎'}</span>
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{result.file.displayName}</p>
                                        <p className={`text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>in {result.projectName}</p>
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Notes */}
                          {searchResults.notes.length > 0 && (
                            <div>
                              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                Notes ({searchResults.notes.length})
                              </h3>
                              <div className="space-y-1">
                                {searchResults.notes.map((result, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => {
                                      const project = projects.find(p => p.id === result.projectId);
                                      if (project) {
                                        setShowSearchModal(false);
                                        setSearchQuery('');
                                        onSelectProject(project, { initialTab: 'notes' });
                                      }
                                    }}
                                    className={`w-full text-left p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#3a3a3c]' : 'hover:bg-gray-100'}`}
                                  >
                                    <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{result.note.title}</p>
                                    <p className={`text-xs line-clamp-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>{result.note.content}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Tasks */}
                          {searchResults.tasks.length > 0 && (
                            <div>
                              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                Tasks ({searchResults.tasks.length})
                              </h3>
                              <div className="space-y-1">
                                {searchResults.tasks.map((result, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => {
                                      const project = projects.find(p => p.id === result.projectId);
                                      if (project) {
                                        setShowSearchModal(false);
                                        setSearchQuery('');
                                        onSelectProject(project, { initialTab: 'tasks' });
                                      }
                                    }}
                                    className={`w-full text-left p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#3a3a3c]' : 'hover:bg-gray-100'}`}
                                  >
                                    <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{result.task.title}</p>
                                    <p className={`text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>in {result.projectName}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Assets */}
                          {searchResults.assets.length > 0 && (
                            <div>
                              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                Assets ({searchResults.assets.length})
                              </h3>
                              <div className="grid grid-cols-2 gap-2">
                                {searchResults.assets.map((result, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => {
                                      const project = projects.find(p => p.id === result.projectId);
                                      if (project) {
                                        setShowSearchModal(false);
                                        setSearchQuery('');
                                        const isVideo = result.type === 'video';
                                        onSelectProject(project, {
                                          initialTab: 'assets',
                                          initialAssetType: isVideo ? 'videos' : 'images'
                                        });
                                      }
                                    }}
                                    className={`text-left p-2 rounded-lg border transition-all ${isDarkMode ? 'bg-[#2d2d2f] border-[#3d3d3f] hover:border-[#5d5d5f] hover:bg-[#3d3d3f]' : 'bg-gray-50 border-gray-200 hover:border-gray-300 hover:bg-white'}`}
                                  >
                                    {result.type === 'image' && result.asset.imageUrl && (
                                      <div className="aspect-video rounded-md overflow-hidden mb-1.5 bg-gray-900">
                                        <img src={result.asset.imageUrl} alt={result.asset.alt || result.asset.title} className="w-full h-full object-cover" />
                                      </div>
                                    )}
                                    {result.type === 'video' && (
                                      <div className="aspect-video rounded-md overflow-hidden mb-1.5 bg-gray-900 flex items-center justify-center">
                                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                                        </svg>
                                      </div>
                                    )}
                                    <p className={`text-xs font-medium line-clamp-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                      {result.asset.title || result.asset.alt || 'Untitled'}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </header>


        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 sm:py-32">
            <div className="w-10 h-10 sm:w-12 sm:h-12 border-[3px] border-[#0071e3] border-t-transparent rounded-full animate-spin"></div>
            <p className={"mt-4 text-[15px] " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>Loading your projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 sm:py-32">
            {/* macOS Folder-style empty state illustration */}
            <div className="relative mx-auto mb-6 w-32 sm:w-40 h-24 sm:h-28">
              <svg
                className="w-full h-full"
                viewBox="0 0 300 200"
                preserveAspectRatio="xMidYMid meet"
                fill="none"
              >
                <path
                  d={`
                    M 0 26
                    L 0 184
                    Q 0 200, 16 200
                    L 284 200
                    Q 300 200, 300 184
                    L 300 42
                    Q 300 26, 284 26
                    L 135 26
                    Q 125 26, 120 12
                    L 115 4
                    Q 111 0, 99 0
                    L 16 0
                    Q 0 0, 0 16
                    L 0 26
                    Z
                  `}
                  className={
                    isDarkMode
                      ? "fill-[#1c1c1e] stroke-[#3a3a3c]/50"
                      : "fill-white stroke-gray-200"
                  }
                  strokeWidth="2"
                />
                {/* Plus icon in center */}
                <path
                  d="M150 80 L150 120 M130 100 L170 100"
                  className={isDarkMode ? "stroke-[#48484a]" : "stroke-gray-300"}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h2 className={"text-2xl sm:text-3xl font-semibold mb-3 " + (isDarkMode ? 'text-white' : 'text-gray-900')}>No projects yet</h2>
            <p className={(isDarkMode ? 'text-[#86868b]' : 'text-gray-600') + " text-[15px] sm:text-base mb-8 max-w-md mx-auto px-4 leading-relaxed"}>
              Create your first project to start organizing your research and insights
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-[#0071e3] hover:bg-[#0077ed] text-white px-8 py-3.5 rounded-full font-medium text-[15px] transition-all duration-200 active:scale-[0.98]"
            >
              Create Your First Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {/* Create new project - macOS Folder style */}
            <button
              id="onboarding-create-project"
              onClick={() => setShowCreateModal(true)}
              className="group relative cursor-pointer transition-all duration-300 text-[14px]"
            >
              {/* SVG Folder Shape */}
              <svg
                className="w-full h-full absolute inset-0"
                viewBox="0 0 300 200"
                preserveAspectRatio="none"
                fill="none"
              >
                <path
                  d={`
                    M 0 26
                    L 0 184
                    Q 0 200, 16 200
                    L 284 200
                    Q 300 200, 300 184
                    L 300 42
                    Q 300 26, 284 26
                    L 135 26
                    Q 125 26, 120 12
                    L 115 4
                    Q 111 0, 99 0
                    L 16 0
                    Q 0 0, 0 16
                    L 0 26
                    Z
                  `}
                  className={
                    "transition-all duration-300 " +
                    (isDarkMode
                      ? "stroke-[#3a3a3c] group-hover:stroke-[#5a5a5c]"
                      : "stroke-gray-300 group-hover:stroke-gray-400")
                  }
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  fill="transparent"
                />
              </svg>
              {/* Content */}
              <div className="relative flex flex-col items-center justify-center min-h-[190px] lg:min-h-[130px] p-5 sm:p-6">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#0071e3]/10 text-[#0071e3] mb-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <span className={"font-medium " + (isDarkMode ? 'text-white' : 'text-gray-900')}>Create new project</span>
              </div>
            </button>
            {projects.map((project, index) => {
              const isShared = (project.currentUserRole && project.currentUserRole !== 'owner') || (project.collaborators && project.collaborators.length > 0);
              const sharedLabel = project.currentUserRole && project.currentUserRole !== 'owner'
                ? project.currentUserRole === 'admin'
                  ? 'Admin'
                  : project.currentUserRole === 'editor'
                    ? 'Editor'
                    : 'Viewer'
                : 'Shared';

              let themeColors = project.theme && PASTEL_THEMES[project.theme]
                ? PASTEL_THEMES[project.theme]
                : (isDarkMode ? PASTEL_THEMES.dark : PASTEL_THEMES.light);

              if (isDarkMode && project.theme && project.theme !== 'dark' && project.theme !== 'light') {
                const darkOverrides: Record<string, any> = {
                  orange: {
                    folderFill: 'fill-orange-950/40', folderStroke: 'stroke-orange-500/30',
                    folderHoverFill: 'group-hover:fill-orange-900/50', folderHoverStroke: 'group-hover:stroke-orange-500/50',
                    text: 'text-orange-400', accent: 'text-orange-500', textSecondary: 'text-orange-500/70', border: 'border-orange-500/20', hoverBg: 'hover:bg-orange-500/10'
                  },
                  green: {
                    folderFill: 'fill-emerald-950/40', folderStroke: 'stroke-emerald-500/30',
                    folderHoverFill: 'group-hover:fill-emerald-900/50', folderHoverStroke: 'group-hover:stroke-emerald-500/50',
                    text: 'text-emerald-400', accent: 'text-emerald-500', textSecondary: 'text-emerald-500/70', border: 'border-emerald-500/20', hoverBg: 'hover:bg-emerald-500/10'
                  },
                  blue: {
                    folderFill: 'fill-sky-950/40', folderStroke: 'stroke-sky-500/30',
                    folderHoverFill: 'group-hover:fill-sky-900/50', folderHoverStroke: 'group-hover:stroke-sky-500/50',
                    text: 'text-sky-400', accent: 'text-sky-500', textSecondary: 'text-sky-500/70', border: 'border-sky-500/20', hoverBg: 'hover:bg-sky-500/10'
                  },
                  purple: {
                    folderFill: 'fill-violet-950/40', folderStroke: 'stroke-violet-500/30',
                    folderHoverFill: 'group-hover:fill-violet-900/50', folderHoverStroke: 'group-hover:stroke-violet-500/50',
                    text: 'text-violet-400', accent: 'text-violet-500', textSecondary: 'text-violet-500/70', border: 'border-violet-500/20', hoverBg: 'hover:bg-violet-500/10'
                  },
                  khaki: {
                    folderFill: 'fill-amber-950/40', folderStroke: 'stroke-amber-500/30',
                    folderHoverFill: 'group-hover:fill-amber-900/50', folderHoverStroke: 'group-hover:stroke-amber-500/50',
                    text: 'text-amber-400', accent: 'text-amber-500', textSecondary: 'text-amber-500/70', border: 'border-amber-500/20', hoverBg: 'hover:bg-amber-500/10'
                  },
                  pink: {
                    folderFill: 'fill-pink-950/40', folderStroke: 'stroke-pink-500/30',
                    folderHoverFill: 'group-hover:fill-pink-900/50', folderHoverStroke: 'group-hover:stroke-pink-500/50',
                    text: 'text-pink-400', accent: 'text-pink-500', textSecondary: 'text-pink-500/70', border: 'border-pink-500/20', hoverBg: 'hover:bg-pink-500/10'
                  }
                };
                if (darkOverrides[project.theme]) {
                  themeColors = { ...themeColors, ...darkOverrides[project.theme] };
                }
              }

              return (
                <div
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className="group relative cursor-pointer transition-all duration-300 animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {/* SVG Folder Shape */}
                  <svg
                    className={`w-full h-full absolute inset-0 ${themeColors.text}`}
                    viewBox="0 0 300 200"
                    preserveAspectRatio="none"
                    fill="none"
                  >
                    <path
                      d={`
                        M 0 26
                        L 0 184
                        Q 0 200, 16 200
                        L 284 200
                        Q 300 200, 300 184
                        L 300 42
                        Q 300 26, 284 26
                        L 135 26
                        Q 125 26, 120 12
                        L 115 4
                        Q 111 0, 99 0
                        L 16 0
                        Q 0 0, 0 16
                        L 0 26
                        Z
                      `}
                      className={`transition-all duration-300 ${themeColors.folderFill} ${themeColors.folderStroke} ${themeColors.folderHoverFill} ${themeColors.folderHoverStroke}`}
                      strokeWidth="1"
                    />
                    {/* Hover Contour Glow */}
                    <defs>
                      <linearGradient id={`folder-glow-${project.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d={`
                        M 0 26
                        L 0 184
                        Q 0 200, 16 200
                        L 284 200
                        Q 300 200, 300 184
                        L 300 42
                        Q 300 26, 284 26
                        L 135 26
                        Q 125 26, 120 12
                        L 115 4
                        Q 111 0, 99 0
                        L 16 0
                        Q 0 0, 0 16
                        L 0 26
                        Z
                      `}
                      fill={`url(#folder-glow-${project.id})`}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none ${themeColors.accent}`}
                    />
                  </svg>

                  {/* Shared indicator in tab area */}
                  {isShared && (
                    <div className="absolute top-3 left-4 flex items-center gap-1.5 z-10">
                      <svg
                        className={`w-3.5 h-3.5 ${themeColors.accent}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                      </svg>
                      <span className={`text-xs font-medium ${themeColors.accent}`}>
                        {sharedLabel}
                      </span>
                    </div>
                  )}

                  {/* Content */}
                  <div className="relative px-5 sm:px-6 pt-16 lg:pt-10 pb-3 min-h-[190px] lg:min-h-[150px] flex flex-col justify-end">
                    {/* Hover glow effect */}


                    <div className="relative">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className={`text-lg font-semibold line-clamp-1 transition-colors duration-200 ${themeColors.text} group-hover:${themeColors.accent.replace('text-', 'text-')}`}>
                          {project.name}
                        </h3>
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <button
                            onClick={(e) => handleDuplicateProject(e, project)}
                            className={`p-2 rounded-xl transition-colors ${themeColors.textSecondary} hover:${themeColors.accent} ${themeColors.hoverBg}`}
                            title="Duplicate project"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h8a2 2 0 012 2v8a2 2 0 01-2 2H8a2 2 0 01-2-2V9a2 2 0 012-2z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7V5a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => handleDeleteProject(e, project.id.toString())}
                            className={`p-2 rounded-xl transition-colors ${themeColors.textSecondary} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10`}
                            title="Delete project"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <p className={`${themeColors.textSecondary} text-[14px] mb-3 line-clamp-2 leading-relaxed h-[42px]`}>
                        {project.description || 'No description'}
                      </p>

                      <div className={`flex items-center justify-between text-[13px] pt-4 border-t ${themeColors.border} ${themeColors.textSecondary}`}>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span>{computeSourceCount(project)} sources</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span>{computeAssetCount(project)} assets</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span>{(project.tasks || []).filter(t => t.status === 'todo').length} to do</span>
                          </div>
                        </div>
                        <span>{formatDate(project.lastModified)}</span>
                      </div>


                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer with legal links */}
        <footer className={`mt-16 py-8 border-t flex items-center justify-center gap-3 text-[11px] ${isDarkMode ? 'border-[#3a3a3c]/50 text-[#48484a]' : 'border-gray-100 text-gray-400'}`}>
          <a href="/terms" className={`hover:underline transition-colors ${isDarkMode ? 'hover:text-[#86868b]' : 'hover:text-gray-500'}`}>Terms</a>
          <span>·</span>
          <a href="/privacy" className={`hover:underline transition-colors ${isDarkMode ? 'hover:text-[#86868b]' : 'hover:text-gray-500'}`}>Privacy</a>
        </footer>
      </div>


      <LiveAssistantButton
        onClick={() => setShowHomeAssistant(true)}
        visible={isActive && !showHomeAssistant}
        className={`!bottom-32 sm:!bottom-7 bg-[#0071e3] hover:bg-[#0077ed] shadow-lg shadow-[#0071e3]/40 hover:shadow-[#0071e3]/60 text-white`}
      >
        <span className="absolute right-full mr-3 px-3 py-1.5 bg-[#1d1d1f] text-white text-sm rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap hidden sm:block border border-[#3d3d3f]/50">
          Ask AI
        </span>
      </LiveAssistantButton>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div
          className={"fixed inset-0 z-50 flex items-end sm:items-center justify-center backdrop-blur-xl p-0 sm:p-4 " + (isDarkMode ? 'bg-black/70' : 'bg-black/40')}
          onClick={() => {
            setShowCreateModal(false);
            setNewProjectName('');
            setNewProjectDescription('');
          }}
        >
          <div
            className={"border-t sm:border rounded-t-[28px] sm:rounded-[28px] w-full sm:max-w-[440px] p-6 sm:p-8 shadow-2xl animate-slide-up sm:animate-scale-in " + (isDarkMode ? 'bg-[#1c1c1e] border-[#3a3a3c]/50' : 'bg-white border-gray-200')}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar for mobile */}
            <div className={"w-10 h-1 rounded-full mx-auto mb-6 sm:hidden " + (isDarkMode ? 'bg-[#48484a]' : 'bg-gray-300')}></div>

            <div className="flex items-center justify-between mb-6">
              <h2 className={"text-xl sm:text-2xl font-semibold " + (isDarkMode ? 'text-white' : 'text-gray-900')}>New Project</h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewProjectName('');
                  setNewProjectDescription('');
                }}
                className={"hidden sm:flex p-2 rounded-full transition-colors " + (isDarkMode ? 'text-[#86868b] hover:text-white hover:bg-white/5' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className={"block text-[13px] font-medium mb-2 pl-1 " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-600')}>
                  Project Name
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g., AI Market Research 2026"
                  className={"w-full rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/50 focus:border-transparent transition-all text-[15px] border " + (isDarkMode ? 'bg-[#2c2c2e] border-[#3a3a3c] text-white placeholder-[#636366]' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400')}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#86868b] mb-2 pl-1">
                  Description
                </label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="What is this project about?"
                  rows={3}
                  className={"w-full rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/50 focus:border-transparent transition-all resize-none text-[15px] border " + (isDarkMode ? 'bg-[#2c2c2e] border-[#3a3a3c] text-white placeholder-[#636366]' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400')}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewProjectName('');
                  setNewProjectDescription('');
                }}
                className={"flex-1 px-4 py-3.5 rounded-full transition-all font-medium text-[15px] border " + (isDarkMode ? 'border-[#3a3a3c] text-[#86868b] hover:text-white hover:border-[#636366] hover:bg-white/5' : 'border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400 hover:bg-gray-100')}
              >
                Cancel
              </button>

              <button
                onClick={() => handleCreateProject('dashboard')}
                disabled={!newProjectName.trim() || creating}
                className="flex-1 px-4 py-3.5 bg-[#0071e3] hover:bg-[#0077ed] rounded-full text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] text-[15px]"
              >
                {creating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Creating...
                  </>
                ) : (
                  'Create Project'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes magic-pulse-glow {
          0% {
            box-shadow: 0 0 0 rgba(37, 99, 235, 0.0);
          }
          50% {
            box-shadow: 0 0 32px rgba(37, 99, 235, 0.45);
          }
          100% {
            box-shadow: 0 0 0 rgba(37, 99, 235, 0.0);
          }
        }

        .magic-research-glow {
          animation: magic-pulse-glow 2.6s ease-in-out infinite;
        }

        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes scale-in {
          from {
            transform: scale(0.95);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
        .animate-scale-in {
          animation: scale-in 0.2s ease-out;
        }
        .animate-fade-in {
          animation: fade-in 0.4s ease-out forwards;
          opacity: 0;
        }
      `}</style>


      {/* Global Search Results Modal */}


      <SubscriptionModal
        isOpen={showUpgradeModal}
        onClose={closeUpgradeModal}
        isDarkMode={isDarkMode}
        trigger={upgradeModalTrigger}
        initialTier={initialTier}
      />

      <CreditInfoModal
        isOpen={showCreditInfo}
        onClose={() => setShowCreditInfo(false)}
        isDarkMode={isDarkMode}
        currentCredits={credits}
      />

      {/* Onboarding Tutorial */}
      {showTutorial && (
        <OnboardingTutorial
          steps={tutorialSteps}
          isDarkMode={isDarkMode}
          onComplete={() => setShowTutorial(false)}
          storageKey="freshfront-projects-onboarding"
        />
      )}
    </div>
  );
};
