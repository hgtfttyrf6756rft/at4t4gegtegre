
import React, { useEffect, useState } from 'react';
import { BlogCreator } from './components/BlogCreator';
import { AuthScreen } from './components/AuthScreen';
import { VerifyEmailScreen } from './components/VerifyEmailScreen';
import { ProjectsPage } from './components/ProjectsPage';
import ProjectDashboard from '@/components/ProjectDashboard';
import { AgentDeployPage } from '@/components/AgentDeployPage';
import { HomePage } from './components/HomePage';
import { TermsOfService } from './components/TermsOfService';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { DDIPage } from './components/DDIPage';
import { DDIDeletionStatusPage } from './components/DDIDeletionStatusPage';
import { ProfileSettingsPage } from './components/ProfileSettingsPage';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, saveUserToFirestore } from './services/firebase';
import { storageService } from './services/storageService';
import { ResearchProject, SavedResearch, SavedWebsiteVersion } from './types';
import { useSubscription } from './hooks/useSubscription';
import { authFetch } from './services/authFetch';
import { createOrJoinOrganization } from './services/organizationService';
import { useRealtimeProject } from './hooks/useRealtimeProject';

import { AdminPortal } from './components/AdminPortal';

type AppView = 'projects' | 'dashboard' | 'research' | 'deploy' | 'admin';
type LoggedOutView = 'home' | 'auth' | 'terms' | 'privacy';

const getDDIViewFromPath = (pathname: string): 'ddi' | 'ddiDeletion' | null => {
  const path = (pathname || '').toLowerCase();
  if (path === '/ddi') return 'ddi';
  if (path === '/ddi/deletion') return 'ddiDeletion';
  return null;
};

const getLegalViewFromPath = (pathname: string): LoggedOutView | null => {
  const path = (pathname || '').toLowerCase();
  if (path === '/terms') return 'terms';
  if (path === '/privacy') return 'privacy';
  return null;
};

interface ActiveResearchState {
  projectId: string;
  projectName: string;
  topic: string;
  startedAt: number | null;
}

const App: React.FC = () => {
  const shareMatch = typeof window !== 'undefined'
    ? window.location.pathname.match(/^\/r\/([^/?#]+)/)
    : null;
  const publicShareId = shareMatch?.[1] ? decodeURIComponent(shareMatch[1]) : null;

  const isGoogleDriveCallback =
    typeof window !== 'undefined' && window.location.pathname === '/google-drive/callback';
  const isGoogleCalendarCallback =
    typeof window !== 'undefined' && window.location.pathname === '/google-calendar/callback';
  const isGmailCallback =
    typeof window !== 'undefined' && window.location.pathname === '/gmail/callback';
  const isOutlookCallback =
    typeof window !== 'undefined' && window.location.pathname === '/outlook/callback';
  const isGithubCallback =
    typeof window !== 'undefined' && window.location.pathname === '/github/callback';

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [activeTheme, setActiveTheme] = useState<'light' | 'dark' | 'orange' | 'green' | 'blue' | 'purple' | 'khaki' | 'pink'>(() => {
    const saved = localStorage.getItem('app-active-theme');
    if (saved && ['light', 'dark', 'orange', 'green', 'blue', 'purple', 'khaki', 'pink'].includes(saved)) {
      return saved as any;
    }
    // Migration from old dark mode setting
    const oldDarkMode = localStorage.getItem('theme-dark-mode');
    return oldDarkMode === 'true' ? 'dark' : 'light';
  });

  // Derive isDarkMode for backward compatibility with components that don't use themes
  const isDarkMode = activeTheme === 'dark';

  const [locationPath, setLocationPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'));

  const [loggedOutView, setLoggedOutView] = useState<LoggedOutView>('home');
  const [loggedOutReturnView, setLoggedOutReturnView] = useState<LoggedOutView>('home');

  const [publicSharedResearch, setPublicSharedResearch] = useState<SavedResearch | null>(null);
  const [publicShareLoading, setPublicShareLoading] = useState(false);
  const [publicShareError, setPublicShareError] = useState<string | null>(null);

  const [currentView, setCurrentView] = useState<AppView>('projects');
  const [currentProject, setCurrentProject] = useState<ResearchProject | null>(null);
  const [agentDeployProject, setAgentDeployProject] = useState<ResearchProject | null>(null);
  const [initialResearchTopic, setInitialResearchTopic] = useState<string | null>(null);
  const [loadedResearch, setLoadedResearch] = useState<SavedResearch | null>(null);
  const [loadedWebsiteVersion, setLoadedWebsiteVersion] = useState<SavedWebsiteVersion | null>(null);
  const [activeResearch, setActiveResearch] = useState<ActiveResearchState | null>(null);
  const [activeResearchLogs, setActiveResearchLogs] = useState<string[]>([]);
  const [researchSessionKey, setResearchSessionKey] = useState<number>(0);
  const [projectsVersion, setProjectsVersion] = useState(0);

  const [dashboardNavOptions, setDashboardNavOptions] = useState<{ initialTab?: any; initialAssetType?: string } | undefined>(undefined);

  const { isSubscribed } = useSubscription();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const applyFromPath = async () => {
      const pathname = window.location.pathname;
      setLocationPath(pathname);

      const legalView = getLegalViewFromPath(pathname);
      if (legalView) {
        setLoggedOutView(legalView);
        return;
      }

      if (loggedOutView === 'terms' || loggedOutView === 'privacy') {
        setLoggedOutView(loggedOutReturnView === 'terms' || loggedOutReturnView === 'privacy' ? 'home' : loggedOutReturnView);
      }

      // Sync app view based on path if logged in
      if (user) { // use user state instead of auth.currentUser directly to be safe with reactivity
        if (pathname === '/' || pathname === '/projects') {
          if (currentView !== 'projects') {
            setCurrentView('projects');
            setCurrentProject(null);
          }
        } else if (pathname === '/profile') {
          // Profile handled separately via state, but we can ensure view is correct if needed
        } else if (pathname === '/admin') {
          if (currentView !== 'admin') {
            setCurrentView('admin');
            setCurrentProject(null);
          }
        } else {
          const projectMatch = pathname.match(/^\/project\/([^/]+)/);
          if (projectMatch) {
            const projectId = projectMatch[1];
            const isDeploy = pathname.endsWith('/deploy');
            const targetView = isDeploy ? 'deploy' : 'dashboard';

            if (currentView !== targetView || (currentProject && currentProject.id !== projectId)) {
              try {
                const project = await storageService.getResearchProject(projectId);
                if (project) {
                  if (isDeploy) {
                    setAgentDeployProject(project);
                    setCurrentProject(project);
                    setCurrentView('deploy');
                  } else {
                    setCurrentProject(project);
                    setCurrentView('dashboard');
                    setAgentDeployProject(null);
                  }
                }
              } catch (e) {
                console.error("Failed to sync project from popstate:", e);
              }
            }
          }
        }
      }
    };

    applyFromPath();

    const onPopState = () => {
      applyFromPath();
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [loggedOutReturnView, loggedOutView, currentView, currentProject, user]);

  const navigateLegal = (view: 'terms' | 'privacy') => {
    if (typeof window === 'undefined') return;
    const target = view === 'terms' ? '/terms' : '/privacy';
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target);
    }
    setLocationPath(target);
    setLoggedOutView(view);
  };

  const closeLegal = () => {
    if (typeof window !== 'undefined') {
      if (window.location.pathname === '/terms' || window.location.pathname === '/privacy') {
        window.history.pushState({}, '', '/');
      }
    }
    setLocationPath('/');
    setLoggedOutView(loggedOutReturnView === 'terms' || loggedOutReturnView === 'privacy' ? 'home' : loggedOutReturnView);
  };

  // Theme cycling order with emojis: light (☀️) → dark (🌙) → orange (🍊) → green (🥒) → blue (🫐) → purple (🍇) → khaki (🥜) → pink (🌸) → light
  const THEME_ORDER: Array<'light' | 'dark' | 'orange' | 'green' | 'blue' | 'purple' | 'khaki' | 'pink'> = [
    'light', 'dark', 'orange', 'green', 'blue', 'purple', 'khaki', 'pink'
  ];

  const cycleTheme = () => {
    setActiveTheme(prev => {
      const currentIndex = THEME_ORDER.indexOf(prev);
      const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
      const nextTheme = THEME_ORDER[nextIndex];

      if (currentProject) {
        // Optimistically update local state immediately
        setCurrentProject(p => p ? { ...p, theme: nextTheme } : null);

        // Wait for storage write to confirm before triggering list reload
        // to avoid race condition where ProjectsPage fetches stale data from Firestore
        storageService.updateResearchProject(currentProject.id, { theme: nextTheme })
          .then(() => setProjectsVersion(v => v + 1))
          .catch(console.error);
      } else {
        localStorage.setItem('app-active-theme', nextTheme);
      }
      return nextTheme;
    });
  };

  const toggleLightDark = () => {
    setActiveTheme(prev => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('app-active-theme', nextTheme);
      return nextTheme;
    });
  };


  // Realtime Project Sync
  useRealtimeProject({
    ownerUid: currentProject?.ownerUid,
    projectId: currentProject?.id,
    enabled: !!currentProject,
    onUpdate: (updatedProject) => {
      // Only update if we're still looking at this project
      if (currentProject && currentProject.id === updatedProject.id) {

        // Preserve local client-only state that isn't in Firestore
        // (like transient UI state if any, though most is in components)

        // We act like handleProjectUpdate but originating from remote
        handleProjectUpdate(updatedProject);
      }
    }
  });

  useEffect(() => {
    if (!isGoogleDriveCallback) return;
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = (url.searchParams.get('code') || '').trim();
      const state = (url.searchParams.get('state') || '').trim();

      const decodeState = (): { returnTo?: string } => {
        if (!state) return {};
        try {
          const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized + '==='.slice((normalized.length + 3) % 4);
          const jsonStr = atob(padded);
          const parsed = JSON.parse(jsonStr);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
          return {};
        }
      };

      const returnTo = decodeState().returnTo || '/';

      if (!code) {
        if (!cancelled) {
          window.location.replace(returnTo);
        }
        return;
      }

      if (!auth.currentUser) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(() => {
            resolve();
          }, 5000);
          const unsubscribe = onAuthStateChanged(auth, (u) => {
            if (u) {
              window.clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          });
        });
      }

      try {
        await authFetch('/api/google-drive-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
      } catch (e) {
        console.error('Google Drive token exchange failed', e);
      } finally {
        if (!cancelled) {
          let hasOpener = false;
          try { hasOpener = !!(window.opener && !window.opener.closed); } catch (e) { }
          if (hasOpener) {
            try {
              window.opener.postMessage({ type: 'google-drive:connected' }, window.location.origin);
              window.close();
              return;
            } catch (e) {
              console.error('Failed to notify opener', e);
            }
          }
          window.location.replace(returnTo);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [isGoogleDriveCallback]);

  useEffect(() => {
    if (!isGoogleCalendarCallback) return;
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = (url.searchParams.get('code') || '').trim();
      const state = (url.searchParams.get('state') || '').trim();

      const decodeState = (): { returnTo?: string } => {
        if (!state) return {};
        try {
          const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized + '==='.slice((normalized.length + 3) % 4);
          const jsonStr = atob(padded);
          const parsed = JSON.parse(jsonStr);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
          return {};
        }
      };

      const returnTo = decodeState().returnTo || '/';

      if (!code) {
        if (!cancelled) {
          window.location.replace(returnTo);
        }
        return;
      }

      if (!auth.currentUser) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(() => {
            resolve();
          }, 5000);
          const unsubscribe = onAuthStateChanged(auth, (u) => {
            if (u) {
              window.clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          });
        });
      }

      try {
        await authFetch('/api/google?op=google-calendar-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
      } catch (e) {
        console.error('Google Calendar token exchange failed', e);
      } finally {
        if (!cancelled) {
          let hasOpener = false;
          try { hasOpener = !!(window.opener && !window.opener.closed); } catch (e) { }
          if (hasOpener) {
            try {
              window.opener.postMessage({ type: 'google-calendar:connected' }, window.location.origin);
              window.close();
              return;
            } catch (e) {
              console.error('Failed to notify opener', e);
            }
          }
          window.location.replace(returnTo);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [isGoogleCalendarCallback]);

  const isGmailCallbackMemo = typeof window !== 'undefined' && window.location.pathname === '/gmail/callback';
  useEffect(() => {
    if (!isGmailCallbackMemo) return;
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = (url.searchParams.get('code') || '').trim();
      const state = (url.searchParams.get('state') || '').trim();

      const decodeState = (): { returnTo?: string } => {
        if (!state) return {};
        try {
          const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized + '==='.slice((normalized.length + 3) % 4);
          const jsonStr = atob(padded);
          const parsed = JSON.parse(jsonStr);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
          return {};
        }
      };

      const returnTo = decodeState().returnTo || '/';

      if (!code) {
        if (!cancelled) {
          window.location.replace(returnTo);
        }
        return;
      }

      if (!auth.currentUser) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(() => {
            resolve();
          }, 5000);
          const unsubscribe = onAuthStateChanged(auth, (u) => {
            if (u) {
              window.clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          });
        });
      }

      try {
        await authFetch('/api/email?op=exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, provider: 'gmail' }),
        });
      } catch (e) {
        console.error('Gmail token exchange failed', e);
      } finally {
        if (!cancelled) {
          let hasOpener = false;
          try { hasOpener = !!(window.opener && !window.opener.closed); } catch (e) { }
          if (hasOpener) {
            try {
              window.opener.postMessage({ type: 'gmail:connected' }, window.location.origin);
              window.close();
              return;
            } catch (e) {
              console.error('Failed to notify opener', e);
            }
          }
          window.location.replace(returnTo);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [isGmailCallbackMemo]);

  const isOutlookCallbackMemo = typeof window !== 'undefined' && window.location.pathname === '/outlook/callback';
  useEffect(() => {
    if (!isOutlookCallbackMemo) return;
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = (url.searchParams.get('code') || '').trim();
      const state = (url.searchParams.get('state') || '').trim();

      const decodeState = (): { returnTo?: string } => {
        if (!state) return {};
        try {
          const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized + '==='.slice((normalized.length + 3) % 4);
          const jsonStr = atob(padded);
          const parsed = JSON.parse(jsonStr);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch { return {}; }
      };

      const returnTo = decodeState().returnTo || '/';

      if (!code) {
        if (!cancelled) window.location.replace(returnTo);
        return;
      }

      if (!auth.currentUser) {
        // wait for auth... (simplified here for brevity, assume similar logic)
        await new Promise<void>(resolve => {
          const u = onAuthStateChanged(auth, _u => { u(); resolve(); });
        });
      }

      try {
        await authFetch('/api/email?op=exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, provider: 'outlook' }),
        });
      } catch (e) {
        console.error('Outlook exchange failed', e);
      } finally {
        if (!cancelled) {
          let hasOpener = false;
          try { hasOpener = !!(window.opener && !window.opener.closed); } catch (e) { }
          if (hasOpener) {
            try {
              window.opener.postMessage({ type: 'outlook:connected' }, window.location.origin);
              window.close();
              return;
            } catch (e) { console.error(e); }
          }
          window.location.replace(returnTo);
        }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [isOutlookCallbackMemo]);

  const isYoutubeCallback = typeof window !== 'undefined' && window.location.pathname === '/youtube/callback';

  useEffect(() => {
    if (!isYoutubeCallback) return;
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = (url.searchParams.get('code') || '').trim();
      const state = (url.searchParams.get('state') || '').trim();

      const decodeState = (): { returnTo?: string } => {
        if (!state) return {};
        try {
          const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized + '==='.slice((normalized.length + 3) % 4);
          const jsonStr = atob(padded);
          const parsed = JSON.parse(jsonStr);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
          return {};
        }
      };

      const returnTo = decodeState().returnTo || '/';

      if (!code) {
        if (!cancelled) {
          window.location.replace(returnTo);
        }
        return;
      }

      if (!auth.currentUser) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(() => {
            resolve();
          }, 5000);
          const unsubscribe = onAuthStateChanged(auth, (u) => {
            if (u) {
              window.clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          });
        });
      }

      try {
        // Use the router endpoint
        await authFetch('/api/google?op=youtube-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
      } catch (e) {
        console.error('YouTube token exchange failed', e);
      } finally {
        if (!cancelled) {
          let hasOpener = false;
          try { hasOpener = !!(window.opener && !window.opener.closed); } catch (e) { }
          if (hasOpener) {
            try {
              window.opener.postMessage({ type: 'youtube:connected' }, window.location.origin);
              window.close();
              return;
            } catch (e) {
              console.error('Failed to notify opener', e);
            }
          }
          window.location.replace(returnTo);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [isYoutubeCallback]);

  const isLinkedinCallback = typeof window !== 'undefined' && window.location.pathname === '/linkedin/callback';

  useEffect(() => {
    if (!isLinkedinCallback) return;
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = (url.searchParams.get('code') || '').trim();
      const state = (url.searchParams.get('state') || '').trim();

      const decodeState = (): { returnTo?: string } => {
        if (!state) return {};
        try {
          const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized + '==='.slice((normalized.length + 3) % 4);
          const jsonStr = atob(padded);
          const parsed = JSON.parse(jsonStr);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
          return {};
        }
      };

      const returnTo = decodeState().returnTo || '/';

      if (!code) {
        if (!cancelled) {
          window.location.replace(returnTo);
        }
        return;
      }

      if (!auth.currentUser) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(() => {
            resolve();
          }, 5000);
          const unsubscribe = onAuthStateChanged(auth, (u) => {
            if (u) {
              window.clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          });
        });
      }

      try {
        const res = await authFetch('/api/social?op=linkedin-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Token exchange failed');
        }

        if (!cancelled) {
          let hasOpener = false;
          try { hasOpener = !!(window.opener && !window.opener.closed); } catch (e) { }
          if (hasOpener) {
            try {
              window.opener.postMessage({ type: 'linkedin:connected' }, window.location.origin);
              window.close();
              return;
            } catch (e) {
              console.error('Failed to notify opener', e);
            }
          }
          window.location.replace(returnTo);
        }
      } catch (e: any) {
        console.error('LinkedIn token exchange failed', e);
        if (!cancelled) {
          alert(`LinkedIn Connection Failed: ${e.message}`);
          window.location.replace(returnTo);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [isLinkedinCallback]);

  const isXCallback = typeof window !== 'undefined' && window.location.pathname === '/x/callback';

  useEffect(() => {
    if (!isXCallback) return;
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = (url.searchParams.get('code') || '').trim();
      const state = (url.searchParams.get('state') || '').trim();

      const decodeState = (): { returnTo?: string } => {
        if (!state) return {};
        try {
          const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized + '==='.slice((normalized.length + 3) % 4);
          const jsonStr = atob(padded);
          const parsed = JSON.parse(jsonStr);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
          return {};
        }
      };

      const returnTo = decodeState().returnTo || '/';

      if (!code) {
        if (!cancelled) {
          window.location.replace(returnTo);
        }
        return;
      }

      if (!auth.currentUser) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(() => {
            resolve();
          }, 5000);
          const unsubscribe = onAuthStateChanged(auth, (u) => {
            if (u) {
              window.clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          });
        });
      }

      try {
        const res = await authFetch('/api/social?op=x-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state, uid: auth.currentUser?.uid }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Token exchange failed');
        }

        if (!cancelled) {
          let hasOpener = false;
          try { hasOpener = !!(window.opener && !window.opener.closed); } catch (e) { }
          if (hasOpener) {
            try {
              window.opener.postMessage({ type: 'x:connected' }, window.location.origin);
              window.close();
              return;
            } catch (e) {
              console.error('Failed to notify opener', e);
            }
          }
          window.location.replace(returnTo);
        }
      } catch (e: any) {
        console.error('X token exchange failed', e);
        alert(`X Connection Failed: ${e.message}`);
        // Do not close window so user can see error
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [isXCallback]);

  useEffect(() => {
    if (!publicShareId) return;
    let cancelled = false;
    setPublicShareLoading(true);
    setPublicShareError(null);

    storageService
      .getSharedResearchReport(publicShareId)
      .then((result) => {
        if (cancelled) return;
        if (!result?.report) {
          setPublicShareError('Shared report not found');
          setPublicSharedResearch(null);
          return;
        }
        setPublicSharedResearch({
          id: result.meta?.sessionId || `share-${publicShareId}`,
          timestamp: Date.now(),
          lastModified: Date.now(),
          topic: result.report.topic,
          researchReport: result.report,
          websiteVersions: [],
          noteMapState: [],
          shareId: publicShareId,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('Failed to load shared report', e);
        setPublicShareError(e?.message || 'Failed to load shared report');
        setPublicSharedResearch(null);
      })
      .finally(() => {
        if (cancelled) return;
        setPublicShareLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [publicShareId]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      storageService.setCurrentUser(currentUser?.uid || null);

      if (currentUser) {
        setLoggedOutView('home');
        try {
          await saveUserToFirestore(currentUser);

          if (currentUser.email) {
            await createOrJoinOrganization(currentUser.uid, {
              email: currentUser.email,
              displayName: currentUser.displayName || undefined,
              photoURL: currentUser.photoURL || undefined
            });
          }

          await storageService.syncToFirestore();

          // Check for project ID in URL
          const path = window.location.pathname;
          const projectMatch = path.match(/^\/project\/([^/]+)/);
          if (projectMatch) {
            const projectId = projectMatch[1];
            const isDeploy = path.endsWith('/deploy');
            try {
              const project = await storageService.getResearchProject(projectId);
              if (project) {
                if (isDeploy) {
                  await handleOpenAgentDeploy(project);
                } else {
                  await handleSelectProject(project, { view: 'dashboard' });
                }
              } else {
                console.warn(`Project ${projectId} not found, redirecting to projects list`);
                window.history.replaceState({}, '', '/');
              }
            } catch (e) {
              console.error("Failed to load project from URL:", e);
              window.history.replaceState({}, '', '/');
            }
          }

        } catch (error) {
          console.error("Failed to save user to Firestore:", error);
        }
      } else {
        setCurrentView('projects');
        setCurrentProject(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleVerified = async () => {
    if (user) {
      try {
        await user.getIdToken(true);
      } catch (e) {
        console.error("Token refresh failed", e);
      }
      setForceUpdate(prev => prev + 1);
    }
  };

  const handleSelectProject = async (project: ResearchProject, navOptions?: { initialTab?: any; initialAssetType?: string; view?: 'dashboard' | 'research' }) => {
    console.log('[App] handleSelectProject called with navOptions:', navOptions);
    setDashboardNavOptions(navOptions);
    // Fetch full project data with complete research sessions.
    // Pass ownerUid as override so admin can correctly load foreign projects.
    try {
      const fullProject = await storageService.getResearchProject(project.id, project.ownerUid);
      const selectedProject = fullProject || project;
      setCurrentProject(selectedProject);
      if (selectedProject.theme) {
        setActiveTheme(selectedProject.theme);
      } else {
        // Fallback to global preference if project has no theme
        const saved = localStorage.getItem('app-active-theme');
        if (saved && ['light', 'dark', 'orange', 'green', 'blue', 'purple', 'khaki', 'pink'].includes(saved)) {
          setActiveTheme(saved as any);
        } else {
          setActiveTheme('light');
        }
      }
    } catch (e) {
      console.error("Failed to fetch full project data:", e);
      setCurrentProject(project);
      if (project.theme) {
        setActiveTheme(project.theme);
      } else {
        // Fallback to global preference
        const saved = localStorage.getItem('app-active-theme');
        if (saved && ['light', 'dark', 'orange', 'green', 'blue', 'purple', 'khaki', 'pink'].includes(saved)) {
          setActiveTheme(saved as any);
        } else {
          setActiveTheme('light');
        }
      }
    }
    console.log('[App] After all state updates, dashboardNavOptions should be:', navOptions);
    setCurrentView(navOptions?.view === 'research' ? 'research' : 'dashboard');
    window.history.pushState({}, '', `/project/${project.id}`);
  };

  const restoreGlobalTheme = () => {
    const saved = localStorage.getItem('app-active-theme');
    if (saved && ['light', 'dark', 'orange', 'green', 'blue', 'purple', 'khaki', 'pink'].includes(saved)) {
      setActiveTheme(saved as any);
    } else {
      setActiveTheme('light');
    }
  };

  const handleBackToProjects = () => {
    setCurrentView('projects');
    setInitialResearchTopic(null);
    setLoadedWebsiteVersion(null);
    restoreGlobalTheme();
    window.history.pushState({}, '', '/');
  };

  const handleOpenAgentDeploy = async (project: ResearchProject) => {
    try {
      const fullProject = await storageService.getResearchProject(project.id);
      setAgentDeployProject(fullProject || project);
      setCurrentProject(fullProject || project);
    } catch {
      setAgentDeployProject(project);
      setCurrentProject(project);
    }
    setCurrentView('deploy');
    window.history.pushState({}, '', `/project/${project.id}/deploy`);
  };

  const handleCloseAgentDeploy = () => {
    setCurrentView('dashboard');
    setAgentDeployProject(null);
    if (currentProject) {
      window.history.pushState({}, '', `/project/${currentProject.id}`);
    } else {
      window.history.pushState({}, '', '/');
    }
  };

  const handleStartResearch = (topic?: string, options?: { background?: boolean }) => {
    const isBackground = options?.background;

    // If there's an active in-progress research and no new topic is provided,
    // treat this as a "resume" action: just reopen the Research view without
    // kicking off a new deep research run.
    if (!topic && currentProject?.activeResearchStatus === 'in_progress' && currentProject.activeResearchTopic) {
      setInitialResearchTopic(null);
    } else {
      // Normal path: starting a new deep research session from a topic
      setInitialResearchTopic(topic || null);
      setResearchSessionKey(prev => prev + 1);
    }

    setLoadedResearch(null);
    setLoadedWebsiteVersion(null);

    // In background mode, keep the dashboard visible while BlogCreator
    // auto-starts deep research off-screen using initialResearchTopic.
    if (!isBackground) {
      setCurrentView('research');
    }
  };

  const handleLoadResearch = (research: SavedResearch, version?: SavedWebsiteVersion) => {
    setLoadedResearch(research);
    setLoadedWebsiteVersion(version || null);
    setInitialResearchTopic(null);
    setCurrentView('research');
  };

  const handleResearchCompleted = async (payload: { projectId: string; session: SavedResearch }) => {
    // Prefer the in-memory project that BlogCreator already updated via
    // onProjectUpdate. Re-fetching from Firestore races with the async
    // write and Firestore stores sessions as summary stubs (no researchReport),
    // which causes "Incomplete Data" badges in the dashboard.
    setCurrentProject(prev => {
      if (!prev || prev.id !== payload.projectId) return prev;

      // Ensure the completed session is present with full data
      const existingSessions = prev.researchSessions || [];
      const alreadyHasSession = existingSessions.some(s => s.id === payload.session.id);

      const updatedSessions = alreadyHasSession
        ? existingSessions.map(s => s.id === payload.session.id ? payload.session : s)
        : [payload.session, ...existingSessions];

      return {
        ...prev,
        researchSessions: updatedSessions,
        activeResearchStatus: null,
        activeResearchTopic: null,
        activeResearchStartedAt: null,
        lastModified: Date.now(),
      };
    });

    // Dismiss the floating "Research in progress" indicator immediately
    setActiveResearch(null);
    setActiveResearchLogs([]);

    setLoadedResearch(payload.session);
    setLoadedWebsiteVersion(null);
    setInitialResearchTopic(null);
    setCurrentView('research');
  };

  const handleBackToDashboard = () => {
    // Clear transient research view state and return to the dashboard.
    // We intentionally do NOT reload the project from storage here so that
    // any in-memory flags (like activeResearchStatus/topic) and newly added
    // sessions pushed by BlogCreator via onProjectUpdate are preserved.
    setInitialResearchTopic(null);
    setLoadedResearch(null);
    setLoadedWebsiteVersion(null);
    setCurrentView('dashboard');
  };

  const handleProjectUpdate = (updatedProject: ResearchProject) => {
    // Only replace the currently selected project if it matches the updated one.
    setCurrentProject(prev => {
      if (prev && prev.id === updatedProject.id) {
        // Merge sessions to prevent realtime listener (which only receives stubs
        // from the root document) from overwriting fully-hydrated in-memory sessions.
        const mergedSessions = updatedProject.researchSessions?.map(updatedSession => {
          const localSession = prev.researchSessions?.find(s => s.id === updatedSession.id);
          if (localSession) {
            // If the local session has a full researchReport and the incoming one is just a stub
            // (missing report or it's a minimal object), preserve the local full session fields.
            const hasFullLocalReport = localSession.researchReport && (localSession.researchReport as any).tldr !== undefined;
            const hasIncomingReport = updatedSession.researchReport !== undefined && updatedSession.researchReport !== null;

            if (hasFullLocalReport && !hasIncomingReport) {
              return {
                ...updatedSession,
                researchReport: localSession.researchReport,
                websiteVersions: localSession.websiteVersions?.length ? localSession.websiteVersions : updatedSession.websiteVersions,
                noteMapState: localSession.noteMapState?.length ? localSession.noteMapState : updatedSession.noteMapState,
                uploadedFiles: localSession.uploadedFiles?.length ? localSession.uploadedFiles : updatedSession.uploadedFiles,
                conversations: localSession.conversations?.length ? localSession.conversations : updatedSession.conversations,
                aiThinking: localSession.aiThinking?.length ? localSession.aiThinking : updatedSession.aiThinking,
                assetCaptions: localSession.assetCaptions?.length ? localSession.assetCaptions : updatedSession.assetCaptions,
              };
            }
          }
          return updatedSession;
        }) || [];

        return {
          ...updatedProject,
          researchSessions: mergedSessions,
          // Preserve the role from the existing in-memory project.
          // Firestore documents store collaborator roles like 'viewer'/'editor',
          // but the admin's role is hydrated client-side and must not be overwritten.
          currentUserRole: prev.currentUserRole || updatedProject.currentUserRole,
        };
      }
      return prev;
    });
    setProjectsVersion(v => v + 1);

    // Keep a global view of any in-progress deep research run.
    setActiveResearch(prev => {
      if (updatedProject.activeResearchStatus === 'in_progress' && updatedProject.activeResearchTopic) {
        return {
          projectId: updatedProject.id,
          projectName: updatedProject.name,
          topic: updatedProject.activeResearchTopic,
          startedAt: updatedProject.activeResearchStartedAt ?? null,
        };
      }

      // If this project was previously tracked as active and is now cleared, remove the indicator.
      if (prev && prev.projectId === updatedProject.id) {
        setActiveResearchLogs([]);
        return null;
      }

      return prev;
    });

    // Bump a lightweight version counter so the Projects list view can
    // refresh its data (including uploaded file counts) when we navigate
    // back from the dashboard.
    setProjectsVersion(v => v + 1);
  };

  const handleActiveResearchClick = async () => {
    if (!activeResearch) return;

    // If we're already inside this project, just jump to the Research view.
    if (currentProject && currentProject.id === activeResearch.projectId) {
      handleStartResearch();
      return;
    }

    try {
      const project = await storageService.getResearchProject(activeResearch.projectId);
      if (!project) {
        console.warn('Active research project not found:', activeResearch.projectId);
        return;
      }

      setCurrentProject(project);
      // When reopening from elsewhere (e.g. Projects page), do NOT start a new
      // deep research run. Instead, mirror the dashboard's "View" behavior and
      // simply navigate into the existing in-progress session.
      setInitialResearchTopic(null);
      setLoadedResearch(null);
      setLoadedWebsiteVersion(null);
      setCurrentView('research');
    } catch (e) {
      console.error('Failed to load active research project', e);
    }
  };

  if (isGithubCallback) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} text-sm font-medium`}>
            Connecting GitHub…
          </div>
        </div>
      </div>
    );
  }

  if (isGoogleDriveCallback) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} text-sm font-medium`}>
            Connecting Google Drive…
          </div>
        </div>
      </div>
    );
  }

  if (isGmailCallback) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} text-sm font-medium`}>
            Connecting Gmail…
          </div>
        </div>
      </div>
    );
  }

  if (isOutlookCallback) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} text-sm font-medium`}>
            Connecting Outlook…
          </div>
        </div>
      </div>
    );
  }

  if (isYoutubeCallback) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} text-sm font-medium`}>
            Connecting YouTube…
          </div>
        </div>
      </div>
    );
  }

  if (isLinkedinCallback) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} text-sm font-medium`}>
            Connecting LinkedIn…
          </div>
        </div>
      </div>
    );
  }

  if (isXCallback) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} text-sm font-medium`}>
            Connecting X (Twitter)…
          </div>
        </div>
      </div>
    );
  }

  if (publicShareId) {
    if (publicShareLoading || !publicSharedResearch) {
      return (
        <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className={`text-sm tracking-widest uppercase ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {publicShareError ? publicShareError : 'Loading report'}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="relative h-screen w-full">
        <BlogCreator
          initialResearchTopic={null}
          loadedResearch={publicSharedResearch}
          loadedWebsiteVersion={null}
          isDarkMode={isDarkMode}
          toggleTheme={toggleLightDark}
          isSubscribed={false}
          isShareView={true}
        />
      </div>
    );
  }

  const legalView = getLegalViewFromPath(locationPath);
  if (legalView === 'terms') {
    return <TermsOfService isDarkMode={isDarkMode} onBack={closeLegal} />;
  }

  if (legalView === 'privacy') {
    return <PrivacyPolicy isDarkMode={isDarkMode} onBack={closeLegal} />;
  }

  if (authLoading) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className={`text-sm tracking-widest uppercase ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Initializing</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (loggedOutView === 'terms') {
      return (
        <TermsOfService
          isDarkMode={isDarkMode}
          onBack={closeLegal}
        />
      );
    }

    if (loggedOutView === 'privacy') {
      return (
        <PrivacyPolicy
          isDarkMode={isDarkMode}
          onBack={closeLegal}
        />
      );
    }

    if (loggedOutView === 'auth') {
      return (
        <AuthScreen
          isDarkMode={isDarkMode}
          toggleTheme={cycleTheme}
          onOpenTerms={() => {
            setLoggedOutReturnView('auth');
            navigateLegal('terms');
          }}
          onOpenPrivacy={() => {
            setLoggedOutReturnView('auth');
            navigateLegal('privacy');
          }}
        />
      );
    }

    return (
      <HomePage
        isDarkMode={isDarkMode}
        toggleTheme={toggleLightDark}
        onAuth={() => setLoggedOutView('auth')}
        onOpenTerms={() => {
          setLoggedOutReturnView('home');
          navigateLegal('terms');
        }}
        onOpenPrivacy={() => {
          setLoggedOutReturnView('home');
          navigateLegal('privacy');
        }}
      />
    );
  }

  if (!user.emailVerified) {
    return <VerifyEmailScreen user={user} onVerified={handleVerified} isDarkMode={isDarkMode} />;
  }

  const ddiView = getDDIViewFromPath(locationPath);
  if (ddiView === 'ddi') {
    return <DDIPage isDarkMode={isDarkMode} />;
  }

  if (ddiView === 'ddiDeletion') {
    return <DDIDeletionStatusPage isDarkMode={isDarkMode} />;
  }

  if (locationPath === '/profile') {
    return <ProfileSettingsPage isDarkMode={isDarkMode} currentProject={currentProject} />;
  }

  // Choose the main view based on current route, but keep both the Projects
  // list and the active project's dashboard/research views mounted. This lets
  // an in-progress research session continue streaming even if you navigate
  // back to the Projects page.
  const showProjects = currentView === 'projects';
  const showDashboard = currentView === 'dashboard';
  const showResearch = currentView === 'research';
  const showDeploy = currentView === 'deploy';
  const showAdmin = currentView === 'admin';

  if (showAdmin && user) {
    return (
      <AdminPortal
        user={user}
        isDarkMode={isDarkMode}
        onBack={() => {
          window.history.pushState({}, '', '/');
          setCurrentView('projects');
        }}
        onNavigateToProject={async (projectId, ownerUid) => {
          try {
            // Need to load the project to pass to the dashboard, providing the ownerUid
            const dbProject = await storageService.getResearchProject(projectId, ownerUid);
            if (dbProject) {
              window.history.pushState({}, '', `/project/${projectId}`);
              setCurrentProject(dbProject);
              setCurrentView('dashboard');
            } else {
              alert("Could not load project from database.");
            }
          } catch (e) {
            console.error("Failed to load project from admin", e);
            alert("Error loading project.");
          }
        }}
      />
    );
  }

  if (showDeploy && agentDeployProject) {
    return (
      <AgentDeployPage
        project={agentDeployProject}
        isDarkMode={isDarkMode}
        onBack={handleCloseAgentDeploy}
        onProjectUpdate={(updated) => {
          setAgentDeployProject(updated);
          handleProjectUpdate(updated);
        }}
      />
    );
  }

  const mainContent = (
    <>
      <div style={{ display: showProjects ? 'block' : 'none' }} className="h-full">
        <ProjectsPage
          onSelectProject={handleSelectProject}
          onOpenAgentDeploy={handleOpenAgentDeploy}
          isDarkMode={isDarkMode}
          toggleTheme={toggleLightDark}
          projectsVersion={projectsVersion}
          isActive={showProjects}
        />
      </div>

      {currentProject && (
        <div
          style={{ display: showProjects ? 'none' : 'block' }}
          className={`h-screen w-full ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}
        >
          <div style={{ display: showDashboard ? 'block' : 'none' }} className="h-full">
            <ProjectDashboard
              project={currentProject}
              onBack={handleBackToProjects}
              onStartResearch={handleStartResearch}
              onLoadResearch={handleLoadResearch}
              isDarkMode={isDarkMode}
              activeTheme={activeTheme}
              toggleTheme={cycleTheme}
              onProjectUpdate={handleProjectUpdate}
              isSubscribed={isSubscribed}
              activeResearchLogs={activeResearchLogs}
              activeResearchProjectId={activeResearch?.projectId}
              initialTab={dashboardNavOptions?.initialTab}
              initialAssetType={dashboardNavOptions?.initialAssetType}
              isActive={showDashboard}
              onOpenAgentDeploy={handleOpenAgentDeploy}
            />
          </div>


          <div style={{ display: showResearch ? 'block' : 'none' }} className="h-full">
            <BlogCreator
              key={`${currentProject?.id || 'no-project'}-${researchSessionKey}`}
              currentProject={currentProject}
              initialResearchTopic={initialResearchTopic}
              loadedResearch={loadedResearch}
              loadedWebsiteVersion={loadedWebsiteVersion}
              onBackToDashboard={handleBackToDashboard}
              onProjectUpdate={handleProjectUpdate}
              onResearchCompleted={handleResearchCompleted}
              isDarkMode={isDarkMode}
              toggleTheme={toggleLightDark}
              isSubscribed={isSubscribed}
              onResearchLogsUpdate={setActiveResearchLogs}
            />
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="relative h-screen w-full">
      {activeResearch && (
        <div className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-40 flex justify-center">
          <button
            type="button"
            onClick={handleActiveResearchClick}
            className={`pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2 shadow-lg border text-xs sm:text-sm ${isDarkMode
              ? 'bg-[#1d1d1f]/90 border-[#3d3d3f]/80 text-white'
              : 'bg-white/95 border-gray-200 text-gray-900'
              }`}
          >
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#22c55e]" />
            </span>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-[10px] uppercase tracking-wider opacity-80">
                Research in progress {activeResearch.projectName}
              </span>
              <span className="text-xs sm:text-sm font-medium truncate max-w-[220px] sm:max-w-xs">
                {activeResearch.topic}
              </span>
            </div>
            <span className="text-[11px] sm:text-xs font-medium text-[#0a84ff] whitespace-nowrap">
              View
            </span>
          </button>
        </div>
      )}
      {mainContent}
    </div>
  );
};

export default App;
