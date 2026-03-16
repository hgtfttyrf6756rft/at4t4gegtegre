/* Updated: 2026-02-03T11:17:00 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HomePageAssistant } from './HomePageAssistant';
import { AnimatedEyeIcon } from './AnimatedEyeIcon';

interface HomePageProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  onAuth: () => void;
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ isDarkMode, toggleTheme, onAuth, onOpenTerms, onOpenPrivacy }) => {
  const logoUrl = 'https://inrveiaulksfmzsbyzqj.supabase.co/storage/v1/object/public/images/Untitled%20design.svg';

  const PLATFORM_LOGOS: Record<string, string> = {
    facebook: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp',
    instagram: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp',
    tiktok: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/tiktok-6338432_1280.webp',
    youtube: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png',
    linkedin: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/LinkedIn_logo_initials.png',
    x: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/X-Logo-Round-Color.png',
    gmail: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Google_Gmail_Logo_512px.png',
    outlook: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Microsoft_Outlook_Icon_%282025%E2%80%93present%29.svg.png',
  };

  const [openFaqId, setOpenFaqId] = useState<string | null>(null);
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('annual');

  const demoVideoUrl = 'https://www.youtube.com/embed/d_0_E4pG8fY?autoplay=1';
  const heroYoutubeUrl = 'https://www.youtube.com/embed/d_0_E4pG8fY';

  useEffect(() => {
    if (!isDemoOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDemoOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isDemoOpen]);

  const scrollToId = useCallback((id: string) => {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const navItems = useMemo(
    () => [
      { id: 'features', label: 'Features' },
      { id: 'how-it-works', label: 'How it works' },
      { id: 'use-cases', label: 'Use cases' },
      { id: 'pricing', label: 'Pricing' },
      { id: 'faq', label: 'FAQ' },
    ],
    []
  );

  const howSteps = useMemo(
    () => [
      {
        title: 'Start a project',
        description: '1. Just tell AI what you want to focus on, it will then build your project and start your first research session OR do it all manually, your choice.',
      },
      {
        title: 'Add context',
        description: 'Upload files to your knowledge base for context so research and outputs stay grounded in your own materials.',
      },
      {
        title: 'Run deep research',
        description: 'Search dozens of sites on the web in seconds and generate interactive, sourced reports with widgets and sections designed for exploration.',
      },
      {
        title: 'Use your research',
        description: 'Chat to all your research sessions and their sources to gain new insight. Convert your project into blogs, podcasts, social posts, videos, and websites you can share.',
      },
      {
        title: 'Share & collaborate',
        description: 'Invite teammates to edit and add value to your projects, share public report links when you’re ready to publish or present.',
      },
    ],
    []
  );

  const useCases = useMemo(
    () => [
      {
        title: 'Creators & Influencers',
        description: 'Turn deep research into viral content, sell digital products (PDFs, guides), and automate your social presence.',
        accent: '#0071e3', // Blue
        icon: 'content',
      },
      {
        title: 'Founders & Startups',
        description: 'Validate markets, build MVPs (sites, forms), and launch products in days, not months.',
        accent: '#5e5ce6', // Purple-Blue
        icon: 'founders',
      },
      {
        title: 'Researchers & Consultants',
        description: 'Deliver client-ready interactive reports, comprehensive data tables, and sourced insights that build trust.',
        accent: '#bf5af2', // Purple
        icon: 'consulting',
      },
      {
        title: 'Marketing & Sales Teams',
        description: 'Automate lead gen with sourced research, bulk email campaigns, and conversion-optimized landing pages.',
        accent: '#22c55e', // Green
        icon: 'sales',
      },
    ],
    []
  );

  const renderUseCaseIcon = useCallback((icon: string) => {
    const commonProps = {
      className: 'w-5 h-5',
      fill: 'none',
      viewBox: '0 0 24 24',
      stroke: 'currentColor',
      strokeWidth: 1.8,
    } as const;

    if (icon === 'content') {
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7.25h7.5A2.25 2.25 0 0117.75 9.5v9A2.25 2.25 0 0115.5 20.75H8A2.25 2.25 0 015.75 18.5v-9A2.25 2.25 0 018 7.25z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 11h5.5M9 14h7M9 17h4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.6 3.6l.55-1.1.55 1.1 1.1.55-1.1.55-.55 1.1-.55-1.1-1.1-.55 1.1-.55z" />
        </svg>
      );
    }

    if (icon === 'founders') {
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 2.75l2.2 4.4 4.4 2.2-4.4 2.2L12 16l-2.2-4.4-4.4-2.2 4.4-2.2L12 2.75z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.25v4.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.25 20.75h3.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 12.5l-1.5 1.5M14.25 12.5l1.5 1.5" />
        </svg>
      );
    }

    if (icon === 'consulting') {
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75h15v9.5h-15v-9.5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 20.75h6" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.25v4.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.75 12.75l1.75-1.75 1.75 1.75 3-3" />
        </svg>
      );
    }

    return (
      <svg {...commonProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 20.25v-9.25A2.5 2.5 0 019 8.5h6A2.5 2.5 0 0117.5 11v9.25" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.75 8.5V6.75A3.25 3.25 0 0112 3.5a3.25 3.25 0 013.25 3.25V8.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.25 14.25l1.75 1.75 3.5-3.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 20.25h11" />
      </svg>
    );
  }, []);

  const researchFlowNodes = useMemo(
    () =>
      [
        {
          id: 'projects',
          title: 'Projects',
          caption: 'Workspaces for goals, sources, and outputs',
          detail:
            'Projects organize your research sessions, sources, files, notes, tasks, and downstream assets—so nothing gets lost across iterations.',
          x: 225,
          y: 80,
          accent: '#0a84ff',
          kind: 'core' as const,
        },
        {
          id: 'sessions',
          title: 'Research sessions',
          caption: 'Realtime web research + transparent sources',
          detail:
            'Run focused sessions that discover sources and build a structured evidence base. Sessions can be repeated, refined, and compared over time.',
          x: 225,
          y: 180,
          accent: '#5e5ce6',
          kind: 'core' as const,
        },
        {
          id: 'reports',
          title: 'Interactive report synthesis',
          caption: 'Sourced sections, visuals, and widgets',
          detail:
            'Sessions roll up into interactive reports: structured sections, citations, widgets, and an experience designed for exploration—not static docs.',
          x: 225,
          y: 290,
          accent: '#bf5af2',
          kind: 'core' as const,
        },
        {
          id: 'outputs',
          title: 'Campaign assets + shareable links',
          caption: 'Blogs, podcasts, infographics, websites',
          detail:
            'Convert research into usable outputs such as blogs, videos, infographics, podcasts, social posts—and share via links for teammates or clients.',
          x: 225,
          y: 420,
          accent: '#22c55e',
          kind: 'core' as const,
        },
        {
          id: 'research-data',
          title: 'Research data',
          caption: 'Sources, quotes, entities, insights',
          detail:
            'The evidence layer: links, citations, snippets, structured extracts, and insights you can trace back to primary sources.',
          x: 750,
          y: 295,
          accent: '#0a84ff',
          kind: 'data' as const,
        },
        {
          id: 'mind-map',
          title: 'Mind map data',
          caption: 'Connections across concepts',
          detail:
            'Build a living map of themes and relationships, so you can see how ideas connect across sessions and sources.',
          x: 750,
          y: 375,
          accent: '#5e5ce6',
          kind: 'data' as const,
        },
        {
          id: 'knowledge-base',
          title: 'Knowledge base data',
          caption: 'Your files and materials grounded in context',
          detail:
            'Upload docs, PDFs, and internal context to keep research and outputs grounded in what you already know.',
          x: 750,
          y: 455,
          accent: '#bf5af2',
          kind: 'data' as const,
        },
        {
          id: 'assistant-input',
          title: 'Chatbot + voice input data',
          caption: 'Questions, prompts, and follow-ups',
          detail:
            'Ask questions in chat or voice. Those interactions guide the workflow and help you explore, refine, and generate outputs faster.',
          x: 500,
          y: 60,
          accent: '#5ac8fa',
          kind: 'data' as const,
        },
        {
          id: 'notes',
          title: 'Notes data',
          caption: 'Fast capture + synthesized takeaways',
          detail:
            'Turn discoveries into a durable knowledge layer: notes, synthesis, and decisions that evolve as research updates.',
          x: 750,
          y: 205,
          accent: '#ff9f0a',
          kind: 'data' as const,
        },
        {
          id: 'realtime',
          title: 'Realtime updates',
          caption: 'Source renewing + fresh sessions',
          detail:
            'Keep datasets current: run new sessions, refresh sources, and evolve reports and assets as the web changes.',
          x: 750,
          y: 120,
          accent: '#34d399',
          kind: 'loop' as const,
        },
      ] as const,
    []
  );

  const researchFlowNodeById = useMemo(() => {
    const map = new Map<string, (typeof researchFlowNodes)[number]>();
    researchFlowNodes.forEach(n => map.set(n.id, n));
    return map;
  }, [researchFlowNodes]);

  const researchFlowEdges = useMemo(
    () =>
      [
        { from: 'projects', to: 'sessions' },
        { from: 'sessions', to: 'reports' },
        { from: 'reports', to: 'outputs' },
        { from: 'reports', to: 'research-data' },
        { from: 'reports', to: 'mind-map' },
        { from: 'reports', to: 'knowledge-base' },
        { from: 'assistant-input', to: 'sessions' },
        { from: 'assistant-input', to: 'notes' },
        { from: 'research-data', to: 'notes' },
        { from: 'knowledge-base', to: 'notes' },
        { from: 'notes', to: 'outputs' },
        { from: 'realtime', to: 'sessions' },
        { from: 'realtime', to: 'reports' },
      ] as const,
    []
  );

  const researchFlowEdgePath = useCallback(
    (fromId: string, toId: string) => {
      const a = researchFlowNodeById.get(fromId);
      const b = researchFlowNodeById.get(toId);
      if (!a || !b) return '';
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      if (ady > adx) {
        const bend = Math.min(140, ady * 0.6);
        const c1x = a.x;
        const c1y = a.y + Math.sign(dy) * bend;
        const c2x = b.x;
        const c2y = b.y - Math.sign(dy) * bend;
        return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
      }

      const bend = Math.min(160, adx * 0.6);
      const c1x = a.x + Math.sign(dx) * bend;
      const c1y = a.y;
      const c2x = b.x - Math.sign(dx) * bend;
      const c2y = b.y;
      return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
    },
    [researchFlowNodeById]
  );

  const [activeFlowId, setActiveFlowId] = useState<(typeof researchFlowNodes)[number]['id']>('projects');
  const [isFlowAutoPlay, setIsFlowAutoPlay] = useState(true);

  const [assistantDraft, setAssistantDraft] = useState('');
  const [isAssistantMicOn, setIsAssistantMicOn] = useState(false);
  const [assistantMicLevel, setAssistantMicLevel] = useState(0);

  const assistantAudioContextRef = useRef<AudioContext | null>(null);
  const assistantMediaStreamRef = useRef<MediaStream | null>(null);
  const assistantRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isFlowAutoPlay) return;

    const ids = researchFlowNodes.map(n => n.id) as Array<(typeof researchFlowNodes)[number]['id']>;
    const interval = window.setInterval(() => {
      setActiveFlowId(prev => {
        const idx = Math.max(0, ids.indexOf(prev));
        return ids[(idx + 1) % ids.length] ?? 'projects';
      });
    }, 3200);

    return () => window.clearInterval(interval);
  }, [activeFlowId, isFlowAutoPlay, researchFlowNodes]);

  const activeFlowNode = researchFlowNodeById.get(activeFlowId) ?? researchFlowNodes[0];

  const stopAssistantMic = useCallback(() => {
    if (assistantRafRef.current != null) {
      window.cancelAnimationFrame(assistantRafRef.current);
      assistantRafRef.current = null;
    }

    if (assistantMediaStreamRef.current) {
      assistantMediaStreamRef.current.getTracks().forEach(t => t.stop());
      assistantMediaStreamRef.current = null;
    }

    if (assistantAudioContextRef.current) {
      assistantAudioContextRef.current.close().catch(() => undefined);
      assistantAudioContextRef.current = null;
    }

    setAssistantMicLevel(0);
    setIsAssistantMicOn(false);
  }, []);

  const toggleAssistantMic = useCallback(async () => {
    if (isAssistantMicOn) {
      stopAssistantMic();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      assistantMediaStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext: AudioContext = new AudioCtx();
      assistantAudioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      setIsAssistantMicOn(true);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] ?? 0;
        const avg = sum / Math.max(1, data.length);
        setAssistantMicLevel(Math.min(1, avg / 90));
        assistantRafRef.current = window.requestAnimationFrame(tick);
      };

      assistantRafRef.current = window.requestAnimationFrame(tick);
    } catch {
      stopAssistantMic();
    }
  }, [isAssistantMicOn, stopAssistantMic]);

  useEffect(() => {
    return () => {
      stopAssistantMic();
    };
  }, [stopAssistantMic]);

  const selectFlowNode = useCallback(
    (id: (typeof researchFlowNodes)[number]['id']) => {
      setIsFlowAutoPlay(false);
      setActiveFlowId(id);
    },
    []
  );

  const researchFlowNodeBadge = useCallback(
    (kind: (typeof researchFlowNodes)[number]['kind']) => {
      if (kind === 'core') return 'Core flow';
      if (kind === 'loop') return 'Keeps it fresh';
      return 'Data layer';
    },
    []
  );

  const renderResearchFlowIcon = useCallback((id: string) => {
    const iconProps = {
      className: 'w-5 h-5',
      fill: 'none',
      viewBox: '0 0 24 24',
      stroke: 'currentColor',
      strokeWidth: 1.8,
    } as const;

    if (id === 'projects') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.75 7.5A2.75 2.75 0 017.5 4.75h9A2.75 2.75 0 0119.25 7.5v10A2.75 2.75 0 0116.5 20.25h-9A2.75 2.75 0 014.75 17.5v-10z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 8.75h8M8 12h6M8 15.25h7" />
        </svg>
      );
    }

    if (id === 'sessions') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75a8.25 8.25 0 108.25 8.25" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.25v4.75l3 1.75" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.5 3.5l-2.25 2.25" />
        </svg>
      );
    }

    if (id === 'reports') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 4.75h6l3 3v11.5A2 2 0 0114.5 21.25h-7A2 2 0 015.5 19.25v-12.5A2 2 0 017.5 4.75z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.75v3.5h3.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8M8 15.25h6" />
        </svg>
      );
    }

    if (id === 'outputs') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7.25h8A2.75 2.75 0 0118.75 10v7A2.75 2.75 0 0116 19.75H8A2.75 2.75 0 015.25 17v-7A2.75 2.75 0 018 7.25z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.25 4.25h5.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 13.25l2 2 4-4" />
        </svg>
      );
    }

    if (id === 'research-data') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 20.25V9.5A2.75 2.75 0 019.25 6.75h7A2.75 2.75 0 0119 9.5v10.75" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 10.5h6M9.5 13.75h7M9.5 17h4" />
        </svg>
      );
    }

    if (id === 'mind-map') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 7.5a2 2 0 104 0 2 2 0 00-4 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16.5a2 2 0 104 0 2 2 0 00-4 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 17a2 2 0 104 0 2 2 0 00-4 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 8.75l4.5 6.25M7.75 15.25l2.5-3.5" />
        </svg>
      );
    }

    if (id === 'knowledge-base') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.25 6.5A2.75 2.75 0 019 3.75h8.75v14.5A2.75 2.75 0 0115 21H9A2.75 2.75 0 016.25 18.25V6.5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.75 6H9.5M17.75 9.25H9.5M17.75 12.5h-6" />
        </svg>
      );
    }

    if (id === 'assistant-input') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75a7.25 7.25 0 00-7.25 7.25c0 1.8.66 3.45 1.76 4.72L6 20.25l4.24-1.51c.55.16 1.13.24 1.76.24a7.25 7.25 0 000-14.5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 11.25h.01M12 11.25h.01M15 11.25h.01" />
        </svg>
      );
    }

    if (id === 'notes') {
      return (
        <svg {...iconProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.25 4.75h6.5l3 3v11.5A2 2 0 0114.75 21.25h-7.5A2 2 0 015.25 19.25v-12.5A2 2 0 017.25 4.75z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.75 12h6.5M8.75 15.25h5" />
        </svg>
      );
    }

    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12a7.5 7.5 0 10-2.2 5.3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12v4.5h-4.5" />
      </svg>
    );
  }, []);

  const faqs = useMemo(
    () => [
      {
        id: 'faq-1',
        q: 'What makes this different from a normal chat tool?',
        a: 'Instead of one-off answers, you get full projects with live research sessions, sources, interactive reports, context-aware agents, and downstream assets — all organized in one dashboard.',
      },
      {
        id: 'faq-2',
        q: 'Can I share a report with my team or clients?',
        a: 'Yes. Reports can be published as a link so others can view the interactive experience without needing the full workspace.',
      },
      {
        id: 'faq-3',
        q: 'How fast are graphics created?',
        a: 'Since they are generated with AI it is fairly fast, usually done within the minute.',
      },
      {
        id: 'faq-4',
        q: 'Can the AI use my uploaded files?',
        a: 'Yes. Your project knowledge base is used as context during research so outputs stay aligned with your materials.',
      },
      {
        id: 'faq-5',
        q: 'Is the app mobile-friendly?',
        a: 'Reports are designed for mobile reading and interactivity so you can review findings on the go.',
      },
      {
        id: 'faq-6',
        q: 'Do I have to set everything up before getting value?',
        a: 'No. The fastest path is: start a project → run one research session or upload a file → ask AI about the data, create content with it or share a link. The best part is it gives out as much value as you put in.',
      },
      {
        id: 'faq-7',
        q: 'How can I use the platform for business?',
        a: 'FreshFront is a complete business automation suite. Build lead capture forms, run email campaigns with AI-generated templates, create e-commerce stores with Stripe, schedule social posts to 6+ platforms, generate prospect tables for outreach, and produce marketing videos—all powered by your research data.',
      },
      {
        id: 'faq-8',
        q: 'Do my unused credits rollover?',
        a: 'No, credit allowances reset at the start of each billing cycle (monthly or annually) to keep your plan fresh.',
      },
      {
        id: 'faq-9',
        q: 'How accurate is the research data?',
        a: 'Our research agents browse the live web in real-time, citing sources for every claim. You can verify every insight by clicking through to the original source.',
      },
      {
        id: 'faq-10',
        q: 'What is 3D World Generation?',
        a: 'Create immersive 3D environments from text descriptions or reference images. You can explore scenes with virtual camera controls, generate multi-angle shots, and export high-resolution renders for marketing, gaming, social media, or immersive storytelling.',
      },
      {
        id: 'faq-11',
        q: 'Can I manage customer relationships in FreshFront?',
        a: 'Yes. Use AI-powered tables to track leads, create custom forms for data collection, build email templates with our visual builder, and run segmented campaigns. All lead data syncs with your projects for context-aware follow-ups.',
      },
    ],
    []
  );

  type Feature = {
    title: string;
    description: string;
    imageUrl: string;
    darkImageUrl?: string;
    subFeatures?: Array<{ title: string; description: string; imageUrl: string; darkImageUrl?: string }>;
    logos?: string[];
  };

  const features: Feature[] = [
    {
      title: 'Start a research project with one prompt',
      description:
        'Kick off an entire project instantly — the app generates a structured plan, draft topics, notes, tasks, and an initial research session with backlog so you never start from a blank page.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Start%20a%20Research%20Project%20with%20One%20Prompt.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Start%20a%20Research%20Project%20with%20One%20Prompt%20dark.PNG',
    },
    {
      title: 'Unified dashboard for building & managing projects',
      description:
        'All your sessions, sources, assets, tasks, notes, SEO insights, and knowledge base files live in one place — organized by project.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Unified%20Dashboard%20for%20Building%20%26%20Managing%20Your%20Projects.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Unified%20Dashboard%20for%20Building%20%26%20Managing%20Your%20Projects%20dark.PNG',
    },
    {
      title: 'Upload your files and chat with your knowledge base',
      description:
        'Drop in project material such as tables, docs, PDFs, images, video, or audio. The assistant can use your knowledge base as context while researching, asking questions, and generating content.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Upload%20Your%20Files%20and%20Chat%20with%20your%20Knowledge%20Base%202.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Upload%20Your%20Files%20and%20Chat%20with%20your%20Knowledge%20Base%20dark.PNG',
    },
    {
      title: 'Create blogs, videos, infographics, products, websites & more',
      description:
        'Turn your research into quality shareable output. Generate campaign assets directly from your project data and iterate in the same workspace.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/iconsa.png',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/iconsa.png',
    },
    {
      title: 'Unified Social Media Publishing & Scheduling',
      description:
        'Schedule and publish posts to X, LinkedIn, Facebook, Instagram, TikTok, and YouTube directly from your dashboard (3 posts/day on free plan). Use AI to generate captions and hashtags based on your research, and track performance with integrated insights.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/socialmedia.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/socialmediadark.PNG',
      logos: ['x', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'],
    },
    {
      title: 'Bulk Email Campaigns with Gmail & Outlook',
      description:
        'Create professional email templates with a visual builder, connect your Gmail or Outlook account, and send personalized bulk campaigns to leads. Track opens and responses directly in your dashboard.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/emails.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/emailsblack.PNG',
      logos: ['gmail', 'outlook'],
    },
    {
      title: 'Stripe Products & E-commerce Stores',
      description:
        'Create products, generate secure payment links with Stripe, and build full e-commerce storefronts with AI-designed checkout pages. Start selling in minutes.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/stripelightmode.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/stripedarkmode.PNG',
    },
    {
      title: 'Browser Automation — Let AI Browse for You',
      description:
        'Hand off web tasks to AI agents that can navigate sites, fill forms, extract data, and complete research on your behalf. Watch in real-time as the AI browses the web like a human assistant.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/browserautolight.png',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/browserautodark.png',
    },
    {
      title: 'Interactive 3D World Generation',
      description:
        'Create stunning interactive 3D environments from text descriptions or reference images. Explore scenes with virtual game controls, annotate specific angles and export high-resolution video recordings for marketing, gaming, or immersive storytelling.',
      imageUrl:
        'https://techcrunch.com/wp-content/uploads/2025/08/Prompt-Event.gif?w=480',
      darkImageUrl:
        'https://techcrunch.com/wp-content/uploads/2025/08/Prompt-Event.gif?w=480',
    },
    {
      title: 'AI Table Generation with Lead Search',
      description:
        'Generate data tables from research queries, search for leads and prospects, sync with Google Sheets, and export spreadsheets for outreach campaigns and CRM imports.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/tableslight.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/tablesdark.PNG',
    },
    {
      title: 'AI-Powered Lead Capture Forms',
      description:
        'Design beautiful, conversion-optimized lead forms with AI. Collect submissions, manage leads, and export to your email campaigns — all without writing code.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/leadformlightmode.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/leadformdarkmode.PNG',
    },
    {
      title: 'Interactive reports that help you explore your research',
      description:
        'Reports are built to be used — not just read. Explore with dynamic widgets, exercises, games and rich sections that turn findings into activities.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Interactive%20Reports%20Allow%20you%20to%20Explore%20Your%20Research.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Interactive%20Reports%20Allow%20you%20to%20Explore%20Your%20Research%20dark.PNG',
    },
    {
      title: 'Ready to take action',
      description:
        'There is a widget for every need, tailored to your session.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Discover%20Prospects%20%26%20Access%20Realtime%20Opportunities.PNG',
      subFeatures: [
        {
          title: 'Discover Active Opportunities',
          description:
            'Our agents seek active listings in your area that are relevant to your search and list them neatly in the report.',
          imageUrl:
            'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Discover%20Prospects%20%26%20Access%20Realtime%20Opportunities.PNG',
          darkImageUrl:
            'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/opportunities%20dark%20mode.png',
        },
        {
          title: 'Simulate the Experience with Games',
          description:
            'Learn faster by stepping into the shoes of a decision maker that needs to consider key factors of the research to stay in business.',
          imageUrl:
            'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Interactive%20Reports%20Allow%20you%20to%20Explore%20Your%20Research%202.PNG',
          darkImageUrl:
            'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/simulate%20dark%20mdoe.png',
        },
      ],
    },
    {
      title: 'Expand research visually with an AI mind map',
      description:
        'Branch ideas, combine concepts, draw diagrams and explore follow-ups in a visual map that stays linked to your project context.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Expand%20Research%20Visually%20with%20AI%20Mind%20Map.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Expand%20Research%20Visually%20with%20AI%20Mind%20Map%20dark.PNG',
    },
    {
      title: 'Listen on the go with podcasts',
      description:
        'Convert research into a conversation you can listen to — the best way to learn passively and perfect for commuting, workouts, or fast review before a meeting.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Create%20Multi-speaker%20Podcasts%20Summarizing%20Your%20Research%20Data%202.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Create%20Multi-speaker%20Podcasts%20Summarizing%20Your%20Research%20Data%20dark.PNG',
    },
    {
      title: 'Share interactive research reports with one click',
      description:
        'Publish a private report as a public link to share with teammates or clients in seconds. Each public report has its own chatbot that visitors can message regarding the research.',
      imageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Share%20Your%20Interactive%20Research%20Reports%20with%20One%20Click.PNG',
      darkImageUrl:
        'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Share%20Your%20Interactive%20Research%20Reports%20with%20One%20Click%20dark.PNG',
    },
  ];

  const infographicImages = useMemo(() => {
    const urls = [
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic0.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic1.jpg',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic10.jfif',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic11.jfif',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic12.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic13.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic14.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic15.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic16.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic17.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic18.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic19.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic2.jpg',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic20.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic200.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic21.jfif',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic22.jfif',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic23.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic24.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic25.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic26.jpg',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic27.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic28.jpeg',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic29.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic3.jpg',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic30.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic31.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic32.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic33.jfif',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic34.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic35.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic36.png',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic37.jpg',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic39.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic4.jpg',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic40.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic5.jpg',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic6.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infographic7.webp',
      'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/infogrpahic38.png',
    ];

    const num = (url: string) => {
      const m = url.match(/infographic(\d+)/i);
      return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    };

    return urls.slice().sort((a, b) => num(a) - num(b));
  }, []);

  const [infographicSlideIndex, setInfographicSlideIndex] = useState(0);

  useEffect(() => {
    if (infographicImages.length === 0) return;
    const interval = window.setInterval(() => {
      setInfographicSlideIndex(i => (i + 1) % infographicImages.length);
    }, 2600);
    return () => window.clearInterval(interval);
  }, [infographicImages.length]);

  return (
    <div
      className={
        (isDarkMode ? 'bg-[#000000] text-white' : 'bg-white text-gray-900') +
        ' h-screen overflow-y-auto relative scroll-smooth'
      }
    >
      <div className="absolute inset-0 overflow-hidden">
        {isDarkMode ? (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1a1a2e]/70 via-[#000000] to-[#000000]"></div>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-white to-white"></div>
        )}
        <div
          className={
            'absolute top-[-35%] left-[-25%] w-[900px] h-[900px] rounded-full blur-[160px] ' +
            (isDarkMode ? 'bg-gradient-to-br from-[#0071e3]/10 via-[#5e5ce6]/8 to-transparent' : 'bg-gradient-to-br from-blue-200/60 via-indigo-200/50 to-transparent')
          }
        />
        <div
          className={
            'absolute bottom-[-40%] right-[-20%] w-[800px] h-[800px] rounded-full blur-[160px] ' +
            (isDarkMode ? 'bg-gradient-to-tl from-[#bf5af2]/10 via-[#5e5ce6]/7 to-transparent' : 'bg-gradient-to-tl from-purple-200/50 via-pink-200/50 to-transparent')
          }
        />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:90px_90px] [mask-image:radial-gradient(ellipse_at_center,black_12%,transparent_62%)]"></div>
      </div>

      <header className="fixed top-0 left-0 right-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div
            className={
              'mt-4 rounded-2xl border backdrop-blur-xl shadow-lg flex items-center justify-between px-4 sm:px-5 py-3 ' +
              (isDarkMode ? 'bg-[#0b0b0d]/70 border-white/[0.06]' : 'bg-white/75 border-gray-200')
            }
          >
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={logoUrl}
                alt="Logo"
                className="w-8 h-8 object-contain"
                style={isDarkMode ? { filter: 'brightness(0) invert(1)' } : undefined}
              />
              <div className="min-w-0">
                <div className={"text-sm font-semibold tracking-tight truncate " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                  FreshFront
                </div>
                <div className={"text-[11px] truncate " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                  Data in motion
                </div>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-1">
              {navItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToId(item.id)}
                  className={
                    'px-3 py-2 rounded-xl text-sm transition-colors ' +
                    (isDarkMode
                      ? 'text-[#a1a1a6] hover:text-white hover:bg-white/5'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100')
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className={
                  'p-2 rounded-xl border transition-colors ' +
                  (isDarkMode
                    ? 'border-white/[0.06] bg-white/5 hover:bg-white/10 text-[#86868b] hover:text-white'
                    : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900')
                }
                aria-label="Toggle theme"
              >
                {isDarkMode ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.75 9.75 0 1021.752 15.002z"
                    />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 3v2.25m0 13.5V21m9-9h-2.25M5.25 12H3m15.364-6.364l-1.591 1.591M7.227 16.773l-1.591 1.591m0-11.136l1.591 1.591m9.546 9.546l1.591 1.591M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
                    />
                  </svg>
                )}
              </button>

              <button
                type="button"
                onClick={onAuth}
                className="px-4 py-2 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium transition-colors"
              >
                Go to App
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="pt-28 sm:pt-32 pb-10 sm:pb-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
              <div className="lg:col-span-6">
                <div
                  className={
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs mb-5 ' +
                    (isDarkMode ? 'border-white/[0.06] bg-white/5 text-[#86868b]' : 'border-gray-200 bg-white text-gray-600')
                  }
                >
                  <span className="w-2 h-2 rounded-full bg-[#22c55e]"></span>
                  Where information lives <span className="relative inline-block w-4 h-4 ml-1.5"><img src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/zombie.png" alt="zombie" className="absolute -top-4 -left-2 w-8 h-8 max-w-none object-contain" /></span>
                </div>
                <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
                  Data transformation <br />& business automation
                </h1>

                <div className="mt-6 lg:hidden">
                  <div
                    className={
                      'rounded-3xl border overflow-hidden shadow-2xl ' +
                      (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                    }
                  >
                    <div className="aspect-video w-full">
                      <iframe
                        src={heroYoutubeUrl + '?autoplay=1&mute=1&loop=1&playlist=e3pvkzMHcvs'}
                        title="FreshFront Hero Video"
                        className="w-full h-full border-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      ></iframe>
                    </div>
                  </div>
                </div>
                <p className={"mt-5 text-base sm:text-lg leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  Research agents → Content agents → Product agents → Software agents → Marketing agents
                </p>

                <div className="mt-4 flex items-center gap-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/stripe-new-logo-01-1536x1152.avif"
                    alt="Stripe"
                    className="h-9 w-auto object-contain flex-shrink-0"
                  />
                  <div className={"text-sm " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                    Create products from source-backed content and share across all channels.
                  </div>
                </div>

                <div className="mt-4 flex flex-nowrap sm:flex-wrap items-center justify-center sm:justify-start gap-2 sm:gap-4 overflow-x-auto sm:overflow-visible component-scrollbar">
                  {['x', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'].map(platform => (
                    <img
                      key={platform}
                      src={PLATFORM_LOGOS[platform]}
                      alt={platform}
                      className="w-5 h-5 object-contain flex-shrink-0 opacity-100 sm:opacity-60 sm:hover:opacity-100 transition-opacity"
                    />
                  ))}

                  <div className={"hidden sm:block w-px h-4 mx-1 " + (isDarkMode ? 'bg-white/10' : 'bg-gray-200')} />

                  {[
                    { name: 'Drive', url: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Google_Drive_icon_%282020%29.svg.png' },
                    { name: 'Docs', url: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Docs_2020.webp' },
                    { name: 'Sheets', url: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Google_Sheets_logo_%282014-2020%29.svg.png' },
                    { name: 'Gmail', url: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Google_Gmail_Logo_512px.png' },
                    { name: 'Calendar', url: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Google_Calendar_icon_%282020%29.svg.png' },
                    { name: 'Outlook', url: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Microsoft_Outlook_Icon_%282025%E2%80%93present%29.svg.png' },
                  ].map(app => (
                    <img
                      key={app.name}
                      src={app.url}
                      alt={app.name}
                      className="w-5 h-5 object-contain flex-shrink-0 opacity-100 sm:opacity-60 sm:hover:opacity-100 transition-opacity"
                    />
                  ))}
                </div>

                <div className="mt-7 flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={onAuth}
                    className="px-5 py-3 rounded-2xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium transition-colors"
                  >
                    Get started
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDemoOpen(true)}
                    className={
                      'px-5 py-3 rounded-2xl border text-sm font-medium transition-colors ' +
                      (isDarkMode
                        ? 'border-white/[0.06] bg-white/5 hover:bg-white/10 text-white'
                        : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-900')
                    }
                  >
                    Watch Film
                  </button>
                </div>

                <div className={"mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className={"rounded-2xl border p-4 " + (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')}>
                    <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                      Context
                    </div>
                    <div className="mt-1 font-medium">Deep research, Source-stacking, Web search, Knowledge base, Google Drive</div>
                  </div>
                  <div className={"rounded-2xl border p-4 " + (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')}>
                    <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                      Assets
                    </div>
                    <div className="mt-1 font-medium">Products, podcasts, PDFs, forms, tables, images, videos, sites</div>
                  </div>
                  <div className={"rounded-2xl border p-4 " + (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')}>
                    <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                      Collaboration
                    </div>
                    <div className="mt-1 font-medium">Share projects with your team, automate more and build context faster</div>
                  </div>
                </div>
              </div>

              <div className="hidden lg:block lg:col-span-6">
                <div
                  className={
                    'rounded-3xl border overflow-hidden shadow-2xl ' +
                    (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                  }
                >
                  <div className="aspect-video w-full">
                    <iframe
                      src={heroYoutubeUrl + '?autoplay=1&mute=1&loop=1&playlist=e3pvkzMHcvs'}
                      title="FreshFront Hero Video"
                      className="w-full h-full border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    ></iframe>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-10 sm:py-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="relative rounded-3xl overflow-hidden">
              {(() => {
                const lightImageUrl = 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/FreshFrontCreative.jpeg';
                const darkImageUrl = 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Generated%20Image%20December%2014%2C%202025%20-%201_23AM%20%281%29.png';
                const imageUrl = isDarkMode ? darkImageUrl : lightImageUrl;

                return (
                  <>
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        WebkitMaskImage: 'radial-gradient(closest-side, rgba(0,0,0,1) 85%, rgba(0,0,0,0) 100%)',
                        maskImage: 'radial-gradient(closest-side, rgba(0,0,0,1) 85%, rgba(0,0,0,0) 100%)',
                      }}
                    >
                      <img
                        src={imageUrl}
                        alt=""
                        aria-hidden="true"
                        className="w-full h-full object-cover scale-125 blur-3xl opacity-60"
                        loading="lazy"
                      />
                    </div>

                    <div
                      className={
                        'absolute inset-0 pointer-events-none ' +
                        (isDarkMode
                          ? 'bg-gradient-to-b from-[#000000]/0 via-[#000000]/28 to-[#000000]'
                          : 'bg-gradient-to-b from-white/0 via-white/35 to-white')
                      }
                    />

                    <div className="relative grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 md:gap-10 items-center">
                      <div className="md:col-span-4 order-2 md:order-1 p-5 sm:p-8">
                        <div
                          className={
                            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs w-fit ' +
                            (isDarkMode ? 'border-white/[0.08] bg-black/30 text-[#c7c7cc]' : 'border-gray-200 bg-white/70 text-gray-700')
                          }
                        >
                          <span className="w-2 h-2 rounded-full bg-[#0a84ff]"></span>
                          Research → Content
                        </div>
                        <h2 className="mt-4 text-xl sm:text-2xl font-semibold tracking-tight">
                          Turn research into production-ready output
                        </h2>
                        <p className={"mt-3 text-sm sm:text-base leading-relaxed " + (isDarkMode ? 'text-[#c7c7cc]' : 'text-gray-600')}>
                          FreshFront connects deep research, uploaded context, and AI workflows so you can transform findings into blogs, websites, posts, and shareable assets—without switching tools.
                        </p>
                        <div className="mt-5">
                          <button
                            type="button"
                            onClick={onAuth}
                            className={
                              'inline-flex items-center gap-2 text-sm font-medium ' +
                              (isDarkMode ? 'text-[#5ac8fa] hover:text-white' : 'text-blue-600 hover:text-blue-700')
                            }
                          >
                            Start building
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="md:col-span-8 order-1 md:order-2 -mx-4 sm:mx-0 px-0 sm:px-6 pb-4 sm:pb-8 md:py-6">
                        <div
                          className="relative"
                          style={{
                            WebkitMaskImage: 'radial-gradient(closest-side, rgba(0,0,0,1) 78%, rgba(0,0,0,0) 100%)',
                            maskImage: 'radial-gradient(closest-side, rgba(0,0,0,1) 78%, rgba(0,0,0,0) 100%)',
                          }}
                        >
                          <img
                            src={imageUrl}
                            alt="FreshFront turns research into content"
                            className="w-full h-[260px] sm:h-[360px] md:h-[520px] object-contain"
                            loading="lazy"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </section>

        <section className="py-10 sm:py-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div
              className={
                'rounded-3xl border overflow-hidden ' +
                (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
              }
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                <div className="lg:col-span-4 p-6 sm:p-8">
                  <h3 className="text-lg sm:text-xl font-semibold tracking-tight">
                    Generate shareable infographics from your research
                  </h3>
                  <div className={"mt-2 text-sm sm:text-base " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                    with Nano Banana Pro in FreshFront, you can now convert your data into beautiful infographics and diagrams that you can share to social media.
                  </div>
                  <div className={"mt-3 text-xs " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                    (all images were generated with Nano Banana Pro)
                  </div>
                  <div className={"mt-4 text-xs " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                    {String(infographicSlideIndex + 1).padStart(2, '0')} / {String(infographicImages.length).padStart(2, '0')}
                  </div>
                </div>

                <div className={"lg:col-span-8 " + (isDarkMode ? 'bg-black/20' : 'bg-gray-50')}>
                  <div className="relative w-full">
                    <div className="relative w-full aspect-[16/10]">
                      <img
                        key={infographicImages[infographicSlideIndex]}
                        src={infographicImages[infographicSlideIndex]}
                        alt={`Infographic ${infographicSlideIndex}`}
                        className="absolute inset-0 w-full h-full object-contain"
                        loading="lazy"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3D World Generation Hero Section */}
        <section className="py-10 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div
              className={
                'rounded-3xl border overflow-hidden relative ' +
                (isDarkMode ? 'border-white/[0.06] bg-gradient-to-br from-indigo-950/40 via-slate-900/60 to-purple-950/40' : 'border-gray-200 bg-gradient-to-br from-indigo-50 via-white to-purple-50')
              }
            >
              {/* Animated background effect */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className={
                  'absolute top-[-50%] right-[-20%] w-[600px] h-[600px] rounded-full blur-[120px] ' +
                  (isDarkMode ? 'bg-indigo-500/15' : 'bg-indigo-200/40')
                } />
                <div className={
                  'absolute bottom-[-30%] left-[-10%] w-[400px] h-[400px] rounded-full blur-[100px] ' +
                  (isDarkMode ? 'bg-purple-500/10' : 'bg-purple-200/30')
                } />
              </div>

              <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 p-8 sm:p-12 items-center">
                {/* Content */}
                <div className="order-2 lg:order-1">
                  <div
                    className={
                      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs mb-5 ' +
                      (isDarkMode ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-indigo-200 bg-indigo-50 text-indigo-700')
                    }
                  >
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                    Now Available
                  </div>
                  <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                    Step into{' '}
                    <span className={isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}>Interactive 3D Worlds</span>
                  </h2>
                  <p className={'mt-4 text-base sm:text-lg leading-relaxed ' + (isDarkMode ? 'text-gray-300' : 'text-gray-600')}>
                    Transform ideas into immersive 3D environments. Generate photorealistic scenes from text or images, explore with virtual game controls, and capture stunning video recordings. (Genie 3 supported soon)
                  </p>

                  <div className="mt-6 grid grid-cols-2 gap-4">
                    {[
                      { icon: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/copy.png', title: 'Text to World', desc: 'Describe your scene' },
                      { icon: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/camera.png', title: 'Image to 3D', desc: 'Upload references' },
                      { icon: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/joystick.png', title: 'Interactive Controls', desc: 'Explore freely' },
                      { icon: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/share.png', title: 'Hi-Res Export', desc: 'Production ready' },
                    ].map(item => (
                      <div
                        key={item.title}
                        className={
                          'p-3 rounded-xl border flex flex-col items-center text-center ' +
                          (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white/80')
                        }
                      >
                        <div className="w-9 h-9 mb-1.5 flex items-center justify-center">
                          <img src={item.icon} alt={item.title} className="w-full h-full object-contain" />
                        </div>
                        <div className={'text-sm font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>{item.title}</div>
                        <div className={'text-xs ' + (isDarkMode ? 'text-gray-400' : 'text-gray-500')}>{item.desc}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={onAuth}
                      className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
                    >
                      Try 3D Generation
                    </button>
                  </div>
                </div>

                {/* Visual */}
                <div className="order-1 lg:order-2">
                  <div
                    className={
                      'rounded-2xl border overflow-hidden shadow-2xl ' +
                      (isDarkMode ? 'border-white/[0.08] shadow-indigo-500/10' : 'border-gray-200 shadow-indigo-200/50')
                    }
                  >
                    <div className="aspect-[16/9] w-full bg-black relative">
                      <video
                        src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Introducing%20Marble%20by%20World%20Labs%20-%20World%20Labs%20%281080p%2C%20h264%2C%20youtube%29.mp4"
                        className="w-full h-full object-cover"
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-white text-xs font-medium">
                        Powered by WorldLabs AI
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI Cofounder Section */}
        <section id="ai-cofounder" className="py-10 sm:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            {/* Section Header */}
            <div className="text-center mb-10 sm:mb-14">
              <div
                className={
                  'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs mb-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5 text-[#86868b]' : 'border-gray-200 bg-white text-gray-600')
                }
              >
                <span className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 animate-pulse"></span>
                Powered by 50+ AI Tools
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Meet Your AI Cofounder
              </h2>
              <p className={'mt-4 text-base sm:text-lg max-w-3xl mx-auto leading-relaxed ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                An intelligent assistant that understands your project context, orchestrates sub-agents for research and content creation, and executes complex workflows through natural conversation.
              </p>
            </div>

            {/* Architecture Flow - Neural Stream Design */}
            <div
              className={
                'rounded-3xl border p-6 sm:p-10 mb-10 overflow-hidden relative ' +
                (isDarkMode ? 'border-white/[0.08] bg-gradient-to-br from-slate-900/80 via-purple-900/10 to-slate-900/80' : 'border-gray-200/80 bg-gradient-to-br from-white via-purple-50/30 to-white')
              }
              style={{ backdropFilter: 'blur(12px)' }}
            >
              {/* Subtle Grid Background */}
              <div className={"absolute inset-0 opacity-30 pointer-events-none " + (isDarkMode ? 'bg-[radial-gradient(#ffffff08_1px,transparent_1px)] bg-[size:24px_24px]' : 'bg-[radial-gradient(#00000008_1px,transparent_1px)] bg-[size:24px_24px]')}></div>

              <h3 className={"text-xl sm:text-2xl font-semibold tracking-tight text-center mb-10 relative z-10 " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                Agentic System Flow
              </h3>

              {/* The Pipeline */}
              <div className="relative z-10 flex flex-col lg:flex-row items-center justify-center gap-4 lg:gap-0">

                {/* Node 1: Context Input */}
                <div className="group flex flex-col items-center w-full lg:w-auto lg:flex-1 max-w-xs">
                  <div className={
                    "w-full p-5 rounded-2xl border transition-all duration-300 " +
                    (isDarkMode
                      ? 'bg-white/[0.03] border-white/[0.1] hover:border-blue-500/40 hover:bg-white/[0.05]'
                      : 'bg-white/70 border-gray-200 hover:border-blue-300 hover:bg-white shadow-sm')
                  } style={{ backdropFilter: 'blur(8px)' }}>
                    <div className="flex items-center gap-4 mb-3">
                      <div className={"w-10 h-10 rounded-xl flex items-center justify-center shrink-0 " + (isDarkMode ? 'bg-blue-500/20' : 'bg-blue-100')}>
                        <img src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/books%20%281%29.png" alt="Context" className="w-6 h-6 object-contain" />
                      </div>
                      <span className={"font-semibold " + (isDarkMode ? 'text-white' : 'text-gray-900')}>Context</span>
                    </div>
                    <p className={"text-xs leading-relaxed " + (isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
                      Files, notes, and research form your project's semantic memory.
                    </p>
                  </div>
                </div>

                {/* Connector 1 */}
                <div className="hidden lg:flex items-center justify-center w-16 relative">
                  <div className={"h-0.5 w-full " + (isDarkMode ? 'bg-gradient-to-r from-blue-500/50 to-purple-500/50' : 'bg-gradient-to-r from-blue-300 to-purple-300')}></div>
                  <div className={"absolute w-2 h-2 rounded-full animate-[ping_2s_ease-in-out_infinite] " + (isDarkMode ? 'bg-blue-400' : 'bg-blue-500')} style={{ left: '20%' }}></div>
                </div>
                <div className={"lg:hidden w-0.5 h-6 " + (isDarkMode ? 'bg-gradient-to-b from-blue-500/50 to-purple-500/50' : 'bg-gradient-to-b from-blue-300 to-purple-300')}></div>

                {/* Node 2: AI Core */}
                <div className="group flex flex-col items-center w-full lg:w-auto lg:flex-1 max-w-sm">
                  <div className={
                    "relative w-full p-6 rounded-2xl border-2 transition-all duration-300 " +
                    (isDarkMode
                      ? 'bg-gradient-to-br from-purple-500/10 via-blue-500/5 to-pink-500/10 border-purple-500/30 hover:border-purple-400/60 shadow-lg shadow-purple-500/10'
                      : 'bg-gradient-to-br from-purple-100/50 via-blue-50/50 to-pink-100/50 border-purple-300 hover:border-purple-400 shadow-lg shadow-purple-200/50')
                  } style={{ backdropFilter: 'blur(12px)' }}>
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-md">
                        ORCHESTRATOR
                      </span>
                    </div>
                    <div className="flex flex-col items-center text-center mt-2">
                      <AnimatedEyeIcon className="w-16 h-16 bg-[#0071e3] mb-3" />
                      <span className={"font-bold text-lg " + (isDarkMode ? 'text-white' : 'text-gray-900')}>AI Cofounder</span>
                      <p className={"text-xs mt-2 leading-relaxed " + (isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
                        Understands your intent and dispatches specialized agents.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Connector 2 */}
                <div className="hidden lg:flex items-center justify-center w-16 relative">
                  <div className={"h-0.5 w-full " + (isDarkMode ? 'bg-gradient-to-r from-purple-500/50 to-pink-500/50' : 'bg-gradient-to-r from-purple-300 to-pink-300')}></div>
                  <div className={"absolute w-2 h-2 rounded-full animate-[ping_2s_ease-in-out_infinite_0.5s] " + (isDarkMode ? 'bg-purple-400' : 'bg-purple-500')} style={{ left: '50%' }}></div>
                </div>
                <div className={"lg:hidden w-0.5 h-6 " + (isDarkMode ? 'bg-gradient-to-b from-purple-500/50 to-pink-500/50' : 'bg-gradient-to-b from-purple-300 to-pink-300')}></div>

                {/* Node 3: Execution Output */}
                <div className="group flex flex-col items-center w-full lg:w-auto lg:flex-1 max-w-xs">
                  <div className={
                    "w-full p-5 rounded-2xl border transition-all duration-300 " +
                    (isDarkMode
                      ? 'bg-white/[0.03] border-white/[0.1] hover:border-pink-500/40 hover:bg-white/[0.05]'
                      : 'bg-white/70 border-gray-200 hover:border-pink-300 hover:bg-white shadow-sm')
                  } style={{ backdropFilter: 'blur(8px)' }}>
                    <div className="flex items-center gap-4 mb-3">
                      <div className={"w-10 h-10 rounded-xl flex items-center justify-center shrink-0 " + (isDarkMode ? 'bg-pink-500/20' : 'bg-pink-100')}>
                        <img src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/network.png" alt="Execution" className="w-6 h-6 object-contain" />
                      </div>
                      <span className={"font-semibold " + (isDarkMode ? 'text-white' : 'text-gray-900')}>Execution</span>
                    </div>
                    <p className={"text-xs leading-relaxed " + (isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
                      Specialized agents for research, content, social, and e-commerce.
                    </p>
                  </div>
                </div>

              </div>
            </div>


            {/* Tool Categories Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Research & Analysis */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/global-research.png"
                    alt="Research"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Research & Analysis</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-blue-500">🌐</span> Start deep research sessions on any topic</div>
                  <div className="flex items-center gap-2"><span className="text-blue-500">📊</span> Analyze files, PDFs, and uploaded documents</div>
                  <div className="flex items-center gap-2"><span className="text-blue-500">🔍</span> Search knowledge base semantically</div>
                  <div className="flex items-center gap-2"><span className="text-blue-500">📈</span> Run SEO analysis with actionable advice</div>
                </div>
              </div>

              {/* Content Creation */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/palette.png"
                    alt="Content"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Content Generation</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-purple-500">🖼️</span> Generate & edit images with Gemini</div>
                  <div className="flex items-center gap-2"><span className="text-purple-500">🎬</span> Create videos from prompts or images</div>
                  <div className="flex items-center gap-2"><span className="text-purple-500">📝</span> Write structured blog posts</div>
                  <div className="flex items-center gap-2"><span className="text-purple-500">🌐</span> Build websites with custom themes</div>
                  <div className="flex items-center gap-2"><span className="text-purple-500">🎙️</span> Generate multi-speaker podcasts</div>
                  <div className="flex items-center gap-2"><span className="text-purple-500">📄</span> Create illustrated PDFs & ebooks</div>
                </div>
              </div>

              {/* Social & Marketing */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 grid grid-cols-2 gap-1 p-0.5">
                    {['x', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'].slice(0, 4).map(p => (
                      <img key={p} src={PLATFORM_LOGOS[p]} className="w-full h-full object-contain" alt={p} />
                    ))}
                  </div>
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Social & Marketing</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-pink-500">📤</span> Post to X, LinkedIn, FB, IG, TikTok, YouTube</div>
                  <div className="flex items-center gap-2"><span className="text-pink-500">📅</span> Schedule posts for optimal times</div>
                  <div className="flex items-center gap-2"><span className="text-pink-500">📧</span> Send & schedule emails via Gmail/Outlook</div>
                  <div className="flex items-center gap-2"><span className="text-pink-500">📨</span> Bulk email campaigns to leads</div>
                </div>
              </div>

              {/* Documents & Data */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/3d-report.png"
                    alt="Documents"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Documents & Data</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-green-500">📝</span> Draft & edit docs with AI assistance</div>
                  <div className="flex items-center gap-2"><span className="text-green-500">📋</span> Generate & manipulate tables</div>
                  <div className="flex items-center gap-2"><span className="text-green-500">📑</span> Sync to Google Sheets</div>
                  <div className="flex items-center gap-2"><span className="text-green-500">🔗</span> Insert inline images & charts</div>
                </div>
              </div>

              {/* E-commerce */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/shop.png"
                    alt="E-commerce"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>E-commerce & Products</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-orange-500">🏪</span> Create Stripe products via chat</div>
                  <div className="flex items-center gap-2"><span className="text-orange-500">🔗</span> Auto-generate payment links</div>
                  <div className="flex items-center gap-2"><span className="text-orange-500">📝</span> Build lead capture forms</div>
                  <div className="flex items-center gap-2"><span className="text-orange-500">💡</span> Product brainstorming & pricing help</div>
                </div>
              </div>

              {/* Project Management */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/check.png"
                    alt="Project Management"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Project Management</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-cyan-500">📋</span> Create, update & delete tasks</div>
                  <div className="flex items-center gap-2"><span className="text-cyan-500">📝</span> Manage project notes</div>
                  <div className="flex items-center gap-2"><span className="text-cyan-500">🗓️</span> Schedule & cancel posts</div>
                  <div className="flex items-center gap-2"><span className="text-cyan-500">📁</span> Browse & retrieve project files</div>
                </div>
              </div>

              {/* CRM & Lead Management */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/magnet.png"
                    alt="CRM"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>CRM & Lead Management</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-rose-500">🔍</span> Prospect search with enrichment data</div>
                  <div className="flex items-center gap-2"><span className="text-rose-500">📧</span> AI email builder with templates</div>
                  <div className="flex items-center gap-2"><span className="text-rose-500">📊</span> Track leads & customer interactions</div>
                  <div className="flex items-center gap-2"><span className="text-rose-500">📝</span> Smart form builder for lead capture</div>
                </div>
              </div>

              {/* 3D & Immersive Media */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/planet-earth.png"
                    alt="3D Media"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>3D & Immersive Media</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-indigo-500">🏔️</span> Generate 3D worlds from prompts</div>
                  <div className="flex items-center gap-2"><span className="text-indigo-500">📸</span> Virtual camera & multi-angle renders</div>
                  <div className="flex items-center gap-2"><span className="text-indigo-500">🎨</span> Reference image to 3D scene</div>
                  <div className="flex items-center gap-2"><span className="text-indigo-500">🎬</span> Export for marketing & storytelling</div>
                </div>
              </div>

              {/* Browser Automation */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/layout.png"
                    alt="Browser Automation"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Browser Automation</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-amber-500">🖱️</span> Navigate websites like a human</div>
                  <div className="flex items-center gap-2"><span className="text-amber-500">📝</span> Autocomplete forms & signups</div>
                  <div className="flex items-center gap-2"><span className="text-amber-500">📥</span> Scrape & structure web data</div>
                  <div className="flex items-center gap-2"><span className="text-amber-500">🔄</span> Automate repetitive web tasks</div>
                </div>
              </div>

              {/* Phone & Voice Agents */}
              <div
                className={
                  'rounded-2xl border p-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-center gap-4 mb-4">
                  <img
                    src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/microphone.png"
                    alt="Phone Agent"
                    className="w-16 h-16 object-contain"
                  />
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Phone & Voice Agents</div>
                </div>
                <div className={'text-xs space-y-2 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  <div className="flex items-center gap-2"><span className="text-blue-500">📱</span> Project Management via SMS & Voice</div>
                  <div className="flex items-center gap-2"><span className="text-blue-500">📞</span> Automated client lead collection</div>
                  <div className="flex items-center gap-2"><span className="text-blue-500">🗓️</span> Book appointments automatically</div>
                  <div className="flex items-center gap-2"><span className="text-blue-500">🤖</span> 24/7 client-facing phone support</div>
                </div>
              </div>
            </div>

            {/* Voice + Chat Modes */}
            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div
                className={
                  'rounded-2xl border p-6 flex items-center gap-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-gradient-to-r from-blue-500/10 to-purple-500/10' : 'border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50')
                }
              >
                <img
                  src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/chat.png"
                  alt="Chat Mode"
                  className="w-12 h-12 object-contain"
                />
                <div>
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Chat Mode</div>
                  <div className={'text-sm mt-1 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                    Type commands, attach files, get inline previews, download buttons, and rich responses.
                  </div>
                </div>
              </div>
              <div
                className={
                  'rounded-2xl border p-6 flex items-center gap-5 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-gradient-to-r from-purple-500/10 to-pink-500/10' : 'border-gray-200 bg-gradient-to-r from-purple-50 to-pink-50')
                }
              >
                <img
                  src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/microphone.png"
                  alt="Voice Mode"
                  className="w-12 h-12 object-contain"
                />
                <div>
                  <div className={'font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Voice Mode</div>
                  <div className={'text-sm mt-1 ' + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                    Real-time voice conversation with full tool access. Speak naturally and let AI execute.
                  </div>
                </div>
              </div>
            </div>


          </div>
        </section>

        {/* Sync Paper Section */}
        <section className="py-10 sm:py-20 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className={
              'rounded-3xl border overflow-hidden relative ' +
              (isDarkMode ? 'border-white/[0.06] bg-gradient-to-br from-slate-950 via-blue-900/10 to-slate-950' : 'border-gray-200 bg-gradient-to-br from-white via-blue-50/30 to-white')
            }>
              <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-10 p-8 sm:p-12 items-center">

                {/* Visual */}
                <div className="order-1 lg:order-1">
                  <div className={
                    'rounded-2xl border overflow-hidden shadow-2xl ' +
                    (isDarkMode ? 'border-white/[0.08] shadow-blue-500/10' : 'border-gray-200 shadow-blue-200/50')
                  }>
                    <div className="aspect-[16/10] w-full bg-black relative">
                      <img
                        src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/liveaivideo.gif"
                        alt="AI Assistant Visual Recognition"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-white text-[10px] font-bold tracking-widest uppercase">
                        Live Video Mode
                      </div>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="order-2 lg:order-2">
                  <div className={
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs mb-5 ' +
                    (isDarkMode ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700')
                  }>
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                    Visual intelligence
                  </div>
                  <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-tight">
                    Sync your paper <br />
                    <span className={isDarkMode ? 'text-blue-400' : 'text-blue-600'}>to your project.</span>
                  </h2>
                  <p className={'mt-4 text-base sm:text-lg leading-relaxed ' + (isDarkMode ? 'text-gray-300' : 'text-gray-600')}>
                    FreshFront's Live Assistant doesn't just hear you—it sees you. Use your camera to bring your physical notebook into the loop. Draft emails, generate assets, and create tasks from handwriting or sketches in realtime.
                  </p>

                  <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <div className={'text-sm font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Visual Tool Calls</div>
                      <p className={'text-xs mt-1.5 ' + (isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
                        Point at a diagram to trigger digital execution. Spoken or drawn commands can initiate complex agent workflows instantly.
                      </p>
                    </div>
                    <div>
                      <div className={'text-sm font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Analog to Digital</div>
                      <p className={'text-xs mt-1.5 ' + (isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
                        Sync notes, create Kanban tasks, and draft emails directly from your pen and paper without ever touching your keyboard.
                      </p>
                    </div>
                  </div>

                  <div className="mt-10">
                    <button
                      type="button"
                      onClick={onAuth}
                      className="px-6 py-3 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium transition-colors shadow-lg shadow-blue-500/20"
                    >
                      Experience Live Assistant
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Phone Agent Section */}
        <section id="phone-agent" className="py-10 sm:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className={
              'rounded-3xl border overflow-hidden relative ' +
              (isDarkMode ? 'border-white/[0.06] bg-gradient-to-br from-slate-950 via-purple-900/10 to-slate-950' : 'border-gray-200 bg-gradient-to-br from-white via-purple-50/30 to-white')
            }>
              <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-10 p-8 sm:p-12 items-center">

                {/* Content */}
                <div className="order-2 lg:order-1">
                  <div className={
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs mb-5 ' +
                    (isDarkMode ? 'border-purple-500/30 bg-purple-500/10 text-purple-300' : 'border-purple-200 bg-purple-50 text-purple-700')
                  }>
                    <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
                    Available on SMS & Voice
                  </div>
                  <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-tight">
                    Your Agent, <br />
                    <span className={isDarkMode ? 'text-purple-400' : 'text-purple-600'}>Now on Speed Dial.</span>
                  </h2>
                  <p className={'mt-4 text-base sm:text-lg leading-relaxed ' + (isDarkMode ? 'text-gray-300' : 'text-gray-600')}>
                    Manage your entire workspace through a single phone number. Whether you're driving, walking, or away from your desk, your AI Cofounder is just a text or call away.
                  </p>

                  <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div>
                      <div className={'text-sm font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Project Management</div>
                      <div className={'mt-2 space-y-2 text-xs ' + (isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
                        <div className="flex items-center gap-2"><span>🚀</span> Start deep research sessions</div>
                        <div className="flex items-center gap-2"><span>📝</span> Create and manage project notes</div>
                        <div className="flex items-center gap-2"><span>📱</span> Post to social media platforms</div>
                        <div className="flex items-center gap-2"><span>📧</span> Automate email campaigns</div>
                        <div className="flex items-center gap-2"><span>🎬</span> Generate images and videos</div>
                      </div>
                    </div>
                    <div>
                      <div className={'text-sm font-semibold ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>Client Facing</div>
                      <div className={'mt-2 space-y-2 text-xs ' + (isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
                        <div className="flex items-center gap-2"><span>👥</span> Collect and qualify leads</div>
                        <div className="flex items-center gap-2"><span>📅</span> Book appointments to calendar</div>
                        <div className="flex items-center gap-2"><span>🔄</span> 24/7 automated responding</div>
                        <div className="flex items-center gap-2"><span>💼</span> Specialized business context</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-10">
                    <button
                      type="button"
                      onClick={onAuth}
                      className="px-6 py-3 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium transition-colors shadow-lg shadow-purple-500/20"
                    >
                      Deploy Your Phone Agent
                    </button>
                  </div>
                </div>

                {/* Visual */}
                <div className="order-1 lg:order-2">
                  <div className={
                    'rounded-2xl border overflow-hidden shadow-2xl ' +
                    (isDarkMode ? 'border-white/[0.08] shadow-purple-500/10' : 'border-gray-200 shadow-purple-200/50')
                  }>
                    <div className="aspect-square w-full bg-black relative">
                      <img
                        src="https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/phoneagent.png"
                        alt="AI Phone Agent Interface"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-white text-[10px] font-bold tracking-widest uppercase">
                        AI Phone System
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-10 sm:py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div
              className={
                'rounded-3xl border p-6 sm:p-10 ' +
                (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
              }
            >
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Why FreshFront now</h2>
              <p className={"mt-4 text-sm sm:text-base leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                AI is changing the way we consume content. For the first time we are asking ourselves which reels are real? Some like it, some hate it, don't even know it was AI, some don't care. We are still early and the truth is it won't matter at the end of the day, it will be indistinguishable. What will matter is the integrity of the content.
                <br /><br />
                FreshFront focuses on context-backed content creation allowing users and teams to upload files, research, stack sources, integrate existing data from other platforms to collaboratively create accurate and relevant content, building multi-modal datasets with the latest text, image, audio and video models. You can then sell it as a product or share creations with your team, email list or to social media with one click. Welcome to your canvas.
              </p>
              <div className={"mt-4 text-xs " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                - a note by the developer
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="py-10 sm:py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Features</h2>
              <p className={"mt-2 text-sm sm:text-base " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                Everything connects: research, sources, notes, files, tasks, assets, and agent context — organized by project.
              </p>
            </div>
            <div className="space-y-10 sm:space-y-14">
              {features.map((feature, idx) => {
                const reverse = idx % 2 === 1;
                const isCompactDuo = Boolean(feature.subFeatures?.length);
                const needsEdgeCrop =
                  feature.title === 'Interactive reports that help you explore your research' ||
                  feature.title === 'Upload your files and chat with your knowledge base';
                const needsLightOnlyEdgeCrop =
                  !isDarkMode && feature.title === 'Start a research project with one prompt';
                const needsTableCrop = feature.title === 'AI Table Generation with Lead Search';
                const featureImageSrc = isDarkMode && feature.darkImageUrl ? feature.darkImageUrl : feature.imageUrl;

                if (isCompactDuo) {
                  return (
                    <div
                      key={feature.title}
                      className={
                        'rounded-3xl border overflow-hidden ' +
                        (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                      }
                    >
                      <div className="p-6 sm:p-8">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{feature.title}</h2>
                            <p className={"mt-2 text-sm leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                              {feature.description}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={onAuth}
                            className={
                              'shrink-0 inline-flex items-center gap-2 text-sm font-medium ' +
                              (isDarkMode ? 'text-[#5ac8fa] hover:text-white' : 'text-blue-600 hover:text-blue-700')
                            }
                          >
                            Explore this feature
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          </button>
                        </div>

                        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                          {feature.subFeatures?.map(sf => {
                            const sfImageSrc = isDarkMode && sf.darkImageUrl ? sf.darkImageUrl : sf.imageUrl;
                            const isDiscover = sf.title === 'Discover Active Opportunities';
                            return (
                              <div
                                key={sf.title}
                                className={
                                  'rounded-2xl border overflow-hidden ' +
                                  (isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-gray-200 bg-white')
                                }
                              >
                                <div className="p-4">
                                  <div className={"text-sm font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                                    {sf.title}
                                  </div>
                                  <div className={"mt-1 text-xs leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                                    {sf.description}
                                  </div>
                                </div>
                                <div className={(isDarkMode ? 'bg-black/25 border-white/[0.06]' : 'bg-gray-50 border-gray-200') + ' border-t'}>
                                  <div className="relative w-full aspect-[16/10]">
                                    <img
                                      src={sfImageSrc}
                                      alt={sf.title}
                                      className={
                                        'absolute inset-0 w-full h-full object-cover ' +
                                        (isDiscover ? 'object-top' : 'object-center')
                                      }
                                      loading="lazy"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={feature.title}
                    className={
                      'rounded-3xl border overflow-hidden ' +
                      (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                    }
                  >
                    <div className={"grid grid-cols-1 md:grid-cols-12 gap-0 " + (reverse ? 'md:[&>*:first-child]:order-2' : '')}>
                      <div className="md:col-span-5 p-6 sm:p-8 flex flex-col justify-center">
                        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
                          {feature.title}
                        </h2>
                        <p className={"mt-3 text-sm sm:text-base leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                          {feature.description}
                        </p>

                        {feature.logos && (
                          <div className="mt-6 flex flex-wrap items-center gap-3">
                            {feature.logos.map((platform) => (
                              <div
                                key={platform}
                                className={"w-10 h-10 rounded-xl flex items-center justify-center border " + (isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200 shadow-sm')}
                                title={platform.charAt(0).toUpperCase() + platform.slice(1)}
                              >
                                <img
                                  src={PLATFORM_LOGOS[platform]}
                                  alt={platform}
                                  className="w-5 h-5 object-contain"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-5">
                          <button
                            type="button"
                            onClick={onAuth}
                            className={
                              'inline-flex items-center gap-2 text-sm font-medium ' +
                              (isDarkMode ? 'text-[#5ac8fa] hover:text-white' : 'text-blue-600 hover:text-blue-700')
                            }
                          >
                            Explore this feature
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="md:col-span-7">
                        <div className={"h-full w-full " + (isDarkMode ? 'bg-black/20' : 'bg-gray-50')}>
                          <img
                            src={featureImageSrc}
                            alt={feature.title}
                            className={
                              'h-full object-cover block ' +
                              (needsEdgeCrop || needsLightOnlyEdgeCrop ? 'w-full scale-[1.01]' : 'w-full')
                            }
                            style={needsTableCrop ? {
                              width: 'calc(100% + 6px)',
                              maxWidth: 'none',
                              clipPath: 'inset(0 6px 0 0)'
                            } : {}}
                            loading="lazy"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="py-10 sm:py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">How it works</h2>
              <p className={"mt-2 text-sm sm:text-base " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                A repeatable workflow from idea → planning → research → enrichment → development → assets → sharing.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              {howSteps.map((step, idx) => (
                <div
                  key={step.title}
                  className={
                    'rounded-2xl border p-5 ' +
                    (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                      Step {idx + 1}
                    </div>
                    <div className={"text-xs font-semibold " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                      {String(idx + 1).padStart(2, '0')}
                    </div>
                  </div>
                  <div className="mt-2 text-sm font-semibold">
                    {step.title}
                  </div>
                  <div className={"mt-2 text-sm leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                    {step.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-10 sm:py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Research flow</h2>
              <p className={"mt-2 text-sm sm:text-base " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                See how projects, sessions, reports, and data layers connect into shareable outputs—then stay fresh with realtime updates.
              </p>
            </div>

            <div
              className={
                'rounded-3xl border overflow-hidden ' +
                (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
              }
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                <div className="lg:col-span-8 p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                      Tap a node to explore
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsFlowAutoPlay(v => !v)}
                      className={
                        'text-xs px-3 py-1.5 rounded-full border transition-colors ' +
                        (isDarkMode
                          ? 'border-white/[0.08] bg-white/5 hover:bg-white/10 text-white'
                          : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-900')
                      }
                    >
                      {isFlowAutoPlay ? 'Auto: On' : 'Auto: Off'}
                    </button>
                  </div>

                  <div className="mt-4">
                    <div className="hidden sm:block relative w-full rounded-2xl overflow-hidden">
                      <div className={"absolute inset-0 pointer-events-none " + (isDarkMode ? 'bg-black/20' : 'bg-gray-50')} />
                      <svg
                        className="absolute inset-0 w-full h-full"
                        viewBox="0 0 1000 520"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        {researchFlowEdges.map(e => {
                          const isActive = e.from === activeFlowId || e.to === activeFlowId;
                          const d = researchFlowEdgePath(e.from, e.to);
                          return (
                            <g key={e.from + '->' + e.to}>
                              <path
                                d={d}
                                fill="none"
                                stroke={isDarkMode ? 'rgba(255,255,255,0.16)' : 'rgba(17,24,39,0.12)'}
                                strokeWidth={2}
                              />
                              <path
                                d={d}
                                fill="none"
                                className={"homeFlowPulse " + (isActive ? 'homeFlowPulseActive' : '')}
                                stroke={isActive ? (activeFlowNode?.accent ?? '#0a84ff') : (isDarkMode ? 'rgba(255,255,255,0.28)' : 'rgba(0,113,227,0.35)')}
                                strokeWidth={2}
                                strokeLinecap="round"
                              />
                            </g>
                          );
                        })}
                      </svg>

                      <div className="relative h-[520px]">
                        <div className="absolute inset-0 pointer-events-none">
                          <div
                            className={
                              'absolute rounded-3xl border ' +
                              (isDarkMode
                                ? 'border-white/[0.06] bg-white/[0.02]'
                                : 'border-gray-200/70 bg-white/60')
                            }
                            style={{ left: '2.5%', top: '5%', width: '40%', height: '90%' }}
                          >
                            <div className={"absolute top-3 left-3 text-[11px] uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                              Core flow
                            </div>
                          </div>

                          <div
                            className={
                              'absolute rounded-3xl border ' +
                              (isDarkMode
                                ? 'border-white/[0.06] bg-white/[0.02]'
                                : 'border-gray-200/70 bg-white/60')
                            }
                            style={{ left: '52%', top: '18%', width: '46%', height: '79%' }}
                          >
                            <div className={"absolute top-3 left-3 text-[11px] uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                              Data layers
                            </div>
                          </div>

                          <div
                            className={
                              'absolute rounded-3xl border ' +
                              (isDarkMode
                                ? 'border-white/[0.06] bg-white/[0.02]'
                                : 'border-gray-200/70 bg-white/60')
                            }
                            style={{ left: '52%', top: '3%', width: '46%', height: '20%' }}
                          >
                            <div className={"absolute top-3 left-3 text-[11px] uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                              Renewal loop
                            </div>
                          </div>
                        </div>

                        {researchFlowNodes.map(n => {
                          const isActive = n.id === activeFlowId;

                          if (n.id === 'assistant-input') {
                            const isListening = isAssistantMicOn;
                            const bars = [0.35, 0.62, 0.5, 0.9, 0.58, 0.4];
                            const accent = n.accent;
                            return (
                              <div
                                key={n.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => selectFlowNode(n.id)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === ' ') selectFlowNode(n.id);
                                }}
                                className={
                                  'absolute -translate-x-1/2 -translate-y-1/2 w-[300px] rounded-3xl border px-3 py-2 text-left transition-all ' +
                                  (isActive ? 'homeFlowNodeActive' : 'homeFlowNode') +
                                  ' z-30 shadow-2xl ' +
                                  (isDarkMode
                                    ? 'border-white/[0.10] bg-black/55 hover:bg-black/65'
                                    : 'border-gray-200 bg-white/90 hover:bg-white')
                                }
                                style={{ left: `${(n.x / 1000) * 100}%`, top: `${(n.y / 520) * 100}%` }}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      className="w-8 h-8 rounded-2xl flex items-center justify-center"
                                      style={{ backgroundColor: `${accent}22`, border: `1px solid ${accent}33`, color: accent }}
                                    >
                                      {renderResearchFlowIcon(n.id)}
                                    </span>
                                    <div className="min-w-0">
                                      <div className={"text-xs font-semibold leading-tight truncate " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                                        {n.title}
                                      </div>
                                      <div className={"text-[11px] leading-snug truncate " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                                        {n.caption}
                                      </div>
                                    </div>
                                  </div>

                                  <div
                                    className={
                                      'shrink-0 rounded-full border px-2 py-0.5 text-[10px] ' +
                                      (isDarkMode
                                        ? 'border-white/[0.10] bg-white/5 text-white'
                                        : 'border-gray-200 bg-gray-50 text-gray-800')
                                    }
                                  >
                                    Primary interface
                                  </div>
                                </div>

                                <div className="mt-2 flex items-center gap-2">
                                  <div
                                    className={
                                      'flex-1 rounded-2xl border px-3 py-2 ' +
                                      (isDarkMode
                                        ? 'border-white/[0.10] bg-black/30'
                                        : 'border-gray-200 bg-white')
                                    }
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <input
                                      value={assistantDraft}
                                      onChange={e => setAssistantDraft(e.target.value)}
                                      onFocus={() => selectFlowNode(n.id)}
                                      className={
                                        'w-full bg-transparent outline-none text-sm ' +
                                        (isDarkMode ? 'text-white placeholder:text-[#86868b]' : 'text-gray-900 placeholder:text-gray-500')
                                      }
                                      placeholder="Ask your project…"
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      selectFlowNode(n.id);
                                      toggleAssistantMic();
                                    }}
                                    className={
                                      'shrink-0 w-10 h-10 rounded-2xl border flex items-center justify-center transition-colors ' +
                                      (isListening
                                        ? (isDarkMode ? 'border-white/[0.18] bg-white/10' : 'border-gray-300 bg-gray-50')
                                        : (isDarkMode ? 'border-white/[0.10] bg-black/30 hover:bg-black/40' : 'border-gray-200 bg-white hover:bg-gray-50'))
                                    }
                                    style={isListening ? { borderColor: `${accent}66` } : undefined}
                                    aria-pressed={isListening}
                                    aria-label={isListening ? 'Stop recording' : 'Start recording'}
                                  >
                                    <svg
                                      className="w-5 h-5"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={1.9}
                                      style={{ color: isListening ? accent : (isDarkMode ? 'white' : '#111827') }}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M12 14.5a3.25 3.25 0 003.25-3.25V6.75A3.25 3.25 0 0012 3.5a3.25 3.25 0 00-3.25 3.25v4.5A3.25 3.25 0 0012 14.5z"
                                      />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 11.25a3.75 3.75 0 007.5 0" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.5v2.25" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 20.75h7" />
                                    </svg>
                                  </button>
                                </div>

                                <div className="mt-1 flex items-center justify-between gap-3" onClick={e => e.stopPropagation()}>
                                  <div className={"text-[11px] " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                                    {isListening ? 'Listening…' : 'Type or tap mic'}
                                  </div>
                                  {isListening && (
                                    <div className="flex items-end gap-1 h-4">
                                      {bars.map((f, idx) => (
                                        <div
                                          key={idx}
                                          className={"w-1 rounded-full " + (isDarkMode ? 'bg-white/20' : 'bg-gray-300')}
                                          style={{
                                            height: `${Math.max(3, Math.round(assistantMicLevel * 14 * f + 3))}px`,
                                            backgroundColor: `${accent}`,
                                            opacity: 0.9,
                                            transition: 'height 120ms ease',
                                          }}
                                        />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => {
                                selectFlowNode(n.id);
                              }}
                              className={
                                'absolute -translate-x-1/2 -translate-y-1/2 w-[240px] rounded-2xl border px-3 py-2 text-left transition-all ' +
                                (isActive ? 'homeFlowNodeActive' : 'homeFlowNode') +
                                ' ' +
                                (isDarkMode
                                  ? 'border-white/[0.08] bg-black/40 hover:bg-black/55'
                                  : 'border-gray-200 bg-white/80 hover:bg-white')
                              }
                              style={{ left: `${(n.x / 1000) * 100}%`, top: `${(n.y / 520) * 100}%` }}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                                  style={{ backgroundColor: `${n.accent}22`, border: `1px solid ${n.accent}33`, color: n.accent }}
                                >
                                  {renderResearchFlowIcon(n.id)}
                                </span>
                                <div className="min-w-0">
                                  <div className={"text-xs font-semibold leading-tight truncate " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                                    {n.title}
                                  </div>
                                  <div className={"text-[11px] leading-snug truncate " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                                    {n.caption}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="sm:hidden">
                      <div className={"text-xs " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                        Swipe through the flow
                      </div>
                      <div className="mt-3 overflow-x-auto -mx-4 px-4">
                        <div className="flex gap-3 snap-x snap-mandatory">
                          {researchFlowNodes.map(n => {
                            const isActive = n.id === activeFlowId;
                            return (
                              <button
                                key={n.id}
                                type="button"
                                onClick={() => {
                                  setIsFlowAutoPlay(false);
                                  setActiveFlowId(n.id);
                                }}
                                className={
                                  'snap-start shrink-0 w-[84%] rounded-3xl border p-4 transition-colors text-left ' +
                                  (isDarkMode
                                    ? 'border-white/[0.06] bg-white/5'
                                    : 'border-gray-200 bg-white')
                                }
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-semibold tracking-tight">{n.title}</div>
                                    <div className={"mt-1 text-xs " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                                      {n.caption}
                                    </div>
                                  </div>
                                  <div
                                    className={
                                      'w-10 h-10 rounded-2xl flex items-center justify-center border ' +
                                      (isActive ? 'homeFlowMiniActive' : '')
                                    }
                                    style={{ backgroundColor: `${n.accent}22`, borderColor: `${n.accent}33`, color: n.accent }}
                                  >
                                    {renderResearchFlowIcon(n.id)}
                                  </div>
                                </div>
                                <div className={"mt-3 text-sm leading-relaxed " + (isDarkMode ? 'text-[#c7c7cc]' : 'text-gray-700')}>
                                  {n.detail}
                                </div>
                                <div className="mt-3">
                                  <span
                                    className={
                                      'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ' +
                                      (isDarkMode
                                        ? 'border-white/[0.08] bg-white/5 text-white'
                                        : 'border-gray-200 bg-gray-50 text-gray-800')
                                    }
                                  >
                                    {researchFlowNodeBadge(n.kind)}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className={
                    'lg:col-span-4 border-t lg:border-t-0 lg:border-l p-5 sm:p-6 ' +
                    (isDarkMode ? 'border-white/[0.06]' : 'border-gray-200')
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                        {researchFlowNodeBadge(activeFlowNode.kind)}
                      </div>
                      <div className="mt-2 text-lg font-semibold tracking-tight">
                        {activeFlowNode.title}
                      </div>
                      <div className={"mt-2 text-sm leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                        {activeFlowNode.detail}
                      </div>
                    </div>
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center"
                      style={{ backgroundColor: `${activeFlowNode.accent}22`, border: `1px solid ${activeFlowNode.accent}33`, color: activeFlowNode.accent }}
                    >
                      {renderResearchFlowIcon(activeFlowNode.id)}
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                      Quick map
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {researchFlowNodes.slice(0, 4).map(n => {
                        const isActive = n.id === activeFlowId;
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => {
                              setIsFlowAutoPlay(false);
                              setActiveFlowId(n.id);
                            }}
                            className={
                              'text-xs px-3 py-1.5 rounded-full border transition-colors ' +
                              (isDarkMode
                                ? 'border-white/[0.08] bg-white/5 hover:bg-white/10'
                                : 'border-gray-200 bg-gray-50 hover:bg-gray-100') +
                              (isActive ? ' homeFlowChipActive' : '')
                            }
                            style={isActive ? { borderColor: `${activeFlowNode.accent}66` } : undefined}
                          >
                            {n.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={onAuth}
                      className="w-full px-5 py-3 rounded-2xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium transition-colors"
                    >
                      Start your first project
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="use-cases" className="py-10 sm:py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Who it’s for</h2>
              <p className={"mt-2 text-sm sm:text-base " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                Built for people who need repeatable, shareable research — and outputs they can actually use.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {useCases.map(c => (
                <div
                  key={c.title}
                  className={
                    'rounded-3xl border p-6 ' +
                    (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold tracking-tight">
                        {c.title}
                      </div>
                      <div className={"mt-2 text-sm leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                        {c.description}
                      </div>
                    </div>
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center"
                      style={{ backgroundColor: `${c.accent}22`, border: `1px solid ${c.accent}33`, color: c.accent }}
                    >
                      {renderUseCaseIcon((c as any).icon)}
                    </div>
                  </div>

                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={onAuth}
                      className={
                        'inline-flex items-center gap-2 text-sm font-medium ' +
                        (isDarkMode ? 'text-[#5ac8fa] hover:text-white' : 'text-blue-600 hover:text-blue-700')
                      }
                    >
                      Start your first project
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="py-10 sm:py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Pricing</h2>
              <p className={"mt-2 text-sm sm:text-base " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                Start free, upgrade when you want more power for research, assets, and collaboration.
              </p>
            </div>

            <div className="flex justify-center mb-8">
              <div className={`p-1 rounded-full border flex items-center cursor-pointer ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'}`}>
                <button
                  onClick={() => setBillingInterval('monthly')}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${billingInterval === 'monthly'
                    ? (isDarkMode ? 'bg-[#3d3d3f] text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm')
                    : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingInterval('annual')}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${billingInterval === 'annual'
                    ? (isDarkMode ? 'bg-[#3d3d3f] text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm')
                    : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
                >
                  Annual <span className="text-[#0071e3] text-xs ml-1 font-semibold">Save 17%</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div
                className={
                  'rounded-3xl border p-6 sm:p-7 ' +
                  (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                  Free
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <div className="text-4xl font-semibold tracking-tight">$0</div>
                  <div className={"text-sm pb-1 " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                    with limits
                  </div>
                </div>
                <div className={"mt-4 text-sm leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                  For trying the workflow and getting value quickly.
                </div>

                <div className="mt-5 space-y-2 text-sm">
                  {[
                    '125 AI credits to start',
                    'Create projects and run research sessions',
                    'Generate interactive reports with sources',
                    'Build a lightweight knowledge base',
                    '3 direct posts/day (no scheduling)',
                  ].map(line => (
                    <div key={line} className="flex items-start gap-2">
                      <div className={"mt-0.5 " + (isDarkMode ? 'text-[#22c55e]' : 'text-green-600')}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </div>
                      <div className={isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-700'}>
                        {line}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={onAuth}
                    className={
                      'px-5 py-3 rounded-2xl border text-sm font-medium transition-colors w-full ' +
                      (isDarkMode
                        ? 'border-white/[0.06] bg-white/5 hover:bg-white/10 text-white'
                        : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-900')
                    }
                  >
                    Start free
                  </button>
                </div>
              </div>

              <div
                className={
                  'rounded-3xl border p-6 sm:p-7 relative overflow-hidden ' +
                  (isDarkMode ? 'border-white/[0.08] bg-white/5' : 'border-gray-200 bg-white')
                }
              >
                <div
                  className={
                    'absolute inset-0 pointer-events-none ' +
                    (isDarkMode
                      ? 'bg-[radial-gradient(circle_at_top,_rgba(0,113,227,0.22),transparent_55%)]'
                      : 'bg-[radial-gradient(circle_at_top,_rgba(0,113,227,0.12),transparent_55%)]')
                  }
                />

                <div className="relative">
                  <div className="flex items-center justify-between gap-3">
                    <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                      Pro
                    </div>
                    <div
                      className={
                        'text-[11px] px-2 py-1 rounded-full border ' +
                        (isDarkMode ? 'border-white/[0.08] bg-white/5 text-white' : 'border-gray-200 bg-gray-50 text-gray-900')
                      }
                    >
                      Popular
                    </div>
                  </div>

                  <div className="mt-2 text-left">
                    <div className="flex items-baseline gap-1">
                      {billingInterval === 'annual' ? (
                        <div className="flex items-baseline">
                          <span className="text-4xl font-bold tracking-tight">$29</span>
                          <span className={`text-xl font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>.08</span>
                        </div>
                      ) : (
                        <div className="text-4xl font-bold tracking-tight">$34.99</div>
                      )}
                      <div className={"text-sm font-medium self-end pb-1.5 " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-500')}>
                        /mo
                      </div>
                    </div>
                    <div className={"mt-1 text-sm " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                      {billingInterval === 'annual' ? (
                        <>
                          Billed annually (<span className={isDarkMode ? 'text-white' : 'text-gray-900'}>$349</span>/yr)
                        </>
                      ) : (
                        'Billed monthly'
                      )}
                    </div>
                  </div>

                  <div className={"mt-4 text-sm leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                    Built for output volume: more research, more assets, more collaboration.
                  </div>

                  <div className="mt-5 space-y-2 text-sm">
                    {[
                      'Everything in Free',
                      '2,500 AI credits per month',
                      'Unlimited social posting & scheduling',
                      'Access to premium models',
                    ].map(line => (
                      <div key={line} className="flex items-start gap-2">
                        <div className={"mt-0.5 " + (isDarkMode ? 'text-[#22c55e]' : 'text-green-600')}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </div>
                        <div className={isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-700'}>
                          {line}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={onAuth}
                      className="px-5 py-3 rounded-2xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium transition-colors w-full"
                    >
                      Upgrade to Pro
                    </button>
                  </div>
                </div>
              </div>

              <div
                className={
                  'rounded-3xl border p-6 sm:p-7 relative overflow-hidden ' +
                  (isDarkMode ? 'border-purple-500/30 bg-white/5' : 'border-purple-300 bg-white')
                }
              >
                <div
                  className={
                    'absolute inset-0 pointer-events-none ' +
                    (isDarkMode
                      ? 'bg-[radial-gradient(circle_at_top,_rgba(147,51,234,0.25),transparent_55%)]'
                      : 'bg-[radial-gradient(circle_at_top,_rgba(147,51,234,0.12),transparent_55%)]')
                  }
                />

                <div className="relative">
                  <div className="flex items-center justify-between gap-3">
                    <div className={"text-xs uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                      Unlimited
                    </div>
                    <div
                      className="text-[11px] px-2 py-1 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium"
                    >
                      No limits
                    </div>
                  </div>

                  <div className="mt-2 text-left">
                    <div className="flex items-baseline gap-1">
                      {billingInterval === 'annual' ? (
                        <div className="flex items-baseline">
                          <span className="text-4xl font-bold tracking-tight">$54</span>
                          <span className={`text-xl font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>.17</span>
                        </div>
                      ) : (
                        <div className="text-4xl font-bold tracking-tight">$79</div>
                      )}
                      <div className={"text-sm font-medium self-end pb-1.5 " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-500')}>
                        /mo
                      </div>
                    </div>
                    <div className={"mt-1 text-sm " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                      {billingInterval === 'annual' ? (
                        <>
                          Billed annually (<span className={isDarkMode ? 'text-white' : 'text-gray-900'}>$649.99</span>/yr)
                        </>
                      ) : (
                        'Billed monthly'
                      )}
                    </div>
                  </div>

                  <div className={"mt-4 text-sm leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                    Everything in Pro, plus unlimited access even after credits run out.
                  </div>

                  <div className="mt-5 space-y-2 text-sm">
                    {[
                      'Everything in Pro',
                      'Unlimited Deep Research',
                      'Unlimited Image & Video Gen',
                      'Unlimited Browser Automation',
                      'Unlimited Podcasts & Emails',
                    ].map(line => (
                      <div key={line} className="flex items-start gap-2">
                        <div className="mt-0.5 text-purple-500">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </div>
                        <div className={isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-700'}>
                          {line}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={onAuth}
                      className="px-5 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 text-white text-sm font-medium transition-colors w-full"
                    >
                      Go Unlimited
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="py-10 sm:py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">FAQ</h2>
              <p className={"mt-2 text-sm sm:text-base " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                Quick answers
              </p>
            </div>

            <div className="space-y-3">
              {faqs.map(item => {
                const isOpen = openFaqId === item.id;
                return (
                  <div
                    key={item.id}
                    className={
                      'rounded-2xl border overflow-hidden ' +
                      (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaqId(prev => (prev === item.id ? null : item.id))}
                      className="w-full text-left px-5 py-4 flex items-center justify-between gap-4"
                    >
                      <div className="text-sm sm:text-base font-medium">
                        {item.q}
                      </div>
                      <div className={"text-xs " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                        {isOpen ? 'Hide' : 'Show'}
                      </div>
                    </button>
                    {isOpen && (
                      <div className={"px-5 pb-5 text-sm leading-relaxed " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div
              className={
                'rounded-3xl border p-8 sm:p-10 text-center ' +
                (isDarkMode ? 'border-white/[0.06] bg-white/5' : 'border-gray-200 bg-white')
              }
            >
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Ready for your next project?</h2>
              <p className={"mt-3 text-sm sm:text-base " + (isDarkMode ? 'text-[#a1a1a6]' : 'text-gray-600')}>
                Sign up and start building today
              </p>
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={onAuth}
                  className="px-6 py-3 rounded-2xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium transition-colors"
                >
                  Sign up / Log in
                </button>
              </div>
            </div>

            <footer className={"mt-8 text-center text-xs " + (isDarkMode ? 'text-[#636366]' : 'text-gray-500')}>
              <div>© 2025 FreshFront</div>
              {(onOpenPrivacy || onOpenTerms) && (
                <div className="mt-2 flex items-center justify-center gap-3">
                  {onOpenPrivacy && (
                    <a
                      href="/privacy"
                      onClick={(e) => {
                        e.preventDefault();
                        onOpenPrivacy();
                      }}
                      className={"transition-colors " + (isDarkMode ? 'hover:text-white' : 'hover:text-gray-900')}
                    >
                      Privacy Policy
                    </a>
                  )}
                  {onOpenTerms && (
                    <a
                      href="/terms"
                      onClick={(e) => {
                        e.preventDefault();
                        onOpenTerms();
                      }}
                      className={"transition-colors " + (isDarkMode ? 'hover:text-white' : 'hover:text-gray-900')}
                    >
                      Terms of Service
                    </a>
                  )}
                </div>
              )}
            </footer>
          </div>
        </section>
      </main>

      {
        isDemoOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Demo video"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/70"
              onClick={() => setIsDemoOpen(false)}
              aria-label="Close demo"
            />

            <div
              className={
                'relative w-full max-w-5xl rounded-3xl border shadow-2xl overflow-hidden ' +
                (isDarkMode ? 'bg-[#0b0b0d] border-white/[0.08]' : 'bg-white border-gray-200')
              }
            >
              <div className="flex items-center justify-between px-4 sm:px-5 py-3">
                <div className={"text-sm font-semibold " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                  Watch Demo
                </div>
                <button
                  type="button"
                  onClick={() => setIsDemoOpen(false)}
                  className={
                    'p-2 rounded-xl transition-colors ' +
                    (isDarkMode ? 'hover:bg-white/10 text-white' : 'hover:bg-gray-100 text-gray-700')
                  }
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="w-full aspect-video bg-black">
                <iframe
                  className="w-full h-full"
                  src={demoVideoUrl}
                  title="FreshFront Film"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          </div>
        )
      }

      <HomePageAssistant isDarkMode={isDarkMode} />

      <style>{`
        @keyframes homeFlowDash {
          0% { stroke-dashoffset: 0; opacity: 0.15; }
          30% { opacity: 0.9; }
          100% { stroke-dashoffset: -220; opacity: 0.15; }
        }

        .homeFlowPulse {
          stroke-dasharray: 7 11;
          stroke-dashoffset: 0;
          animation: homeFlowDash 2.8s linear infinite;
          opacity: 0.25;
        }

        .homeFlowPulseActive {
          opacity: 0.95;
        }

        @keyframes homeFlowFloat {
          0% { transform: translate(-50%, -50%) translateY(0px); }
          50% { transform: translate(-50%, -50%) translateY(-3px); }
          100% { transform: translate(-50%, -50%) translateY(0px); }
        }

        .homeFlowNode {
          transform: translate(-50%, -50%);
        }

        .homeFlowNodeActive {
          transform: translate(-50%, -50%) scale(1.03);
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.18);
          animation: homeFlowFloat 3.2s ease-in-out infinite;
        }

        .homeFlowMiniActive {
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.18);
        }

        .homeFlowChipActive {
          box-shadow: 0 12px 30px rgba(10, 132, 255, 0.12);
        }
      `}</style>
    </div >
  );
};



