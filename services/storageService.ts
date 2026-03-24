import { ResearchReport, SavedProject, SavedWebsiteVersion, ResearchProject, SavedResearch, ProjectTask, ProjectNote, TaskStatus, TaskPriority, KnowledgeBaseFile, ProjectCollaborator, UserProfile, ProjectAccessRole } from '../types.js';
import {
  saveProjectToFirestore,
  getProjectsFromFirestore,
  updateProjectInFirestore,
  deleteProjectFromFirestore,
  addWebsiteVersionToFirestore,
  syncLocalStorageToFirestore,
  createResearchProjectInFirestore,
  getResearchProjectsFromFirestore,
  getResearchProjectFromFirestore,
  updateResearchProjectInFirestore,
  deleteResearchProjectFromFirestore,
  addResearchSessionToProject,
  updateResearchSessionInProject,
  deleteResearchSessionFromProject,
  updateProjectTasksInFirestore,
  updateProjectNotesInFirestore,
  uploadFileToStorage,
  deleteFileFromStorage,
  updateProjectKnowledgeBaseInFirestore,
  updateResearchFilesInFirestore,
  findUserByEmailInFirestore,
  upsertSharedProjectRef,
  removeSharedProjectRef,
  createSharedResearchReportInFirestore,
  getSharedResearchReportFromFirestore,
  updateUserProfileInFirestore,
  getUserFromFirestore,
  uploadProfileImageToStorage,
  updateSharedProjectThemeInFirestore,
  getSharedProjectTheme,
  logProjectActivity,
  getPhoneAgentLeads,
  deletePhoneAgentLead,
  getPhoneAgentNotes,
  savePhoneAgentNote,
  deletePhoneAgentNote
} from './firebase.js';
import { projectCache } from './projectCache.js';
import { authFetch } from './authFetch.js';
import { indexKnowledgeBaseFileToFileSearch } from './geminiService.js';

const STORAGE_KEY = 'gemini_creator_projects_v1';
const RESEARCH_PROJECTS_KEY = 'gemini_research_projects_v1';
const RESEARCH_PROJECTS_OWNER_KEY = 'gemini_research_projects_owner_uid';

let currentUserUid: string | null = null;
let localStorageWriteTimeout: NodeJS.Timeout | null = null;

const debouncedLocalStorageSave = (key: string, data: any) => {
  if (localStorageWriteTimeout) {
    clearTimeout(localStorageWriteTimeout);
  }
  localStorageWriteTimeout = setTimeout(() => {
    localStorage.setItem(key, JSON.stringify(data));
    localStorageWriteTimeout = null;
  }, 100);
};

const immediateLocalStorageSave = (key: string, data: any) => {
  if (localStorageWriteTimeout) {
    clearTimeout(localStorageWriteTimeout);
    localStorageWriteTimeout = null;
  }
  localStorage.setItem(key, JSON.stringify(data));
};

export const storageService = {
  setCurrentUser: (uid: string | null) => {
    currentUserUid = uid;
    if (!uid) {
      projectCache.invalidateAll();
    }
  },

  getCurrentUser: () => currentUserUid,

  getUserProfile: async (): Promise<UserProfile | null> => {
    if (!currentUserUid) return null;
    try {
      // Try to get from Firestore first
      const user = await getUserFromFirestore(currentUserUid);
      if (user) {
        return {
          displayName: user.displayName || undefined,
          photoURL: user.photoURL || undefined,
          email: user.email || undefined,
          // description and themePreference might be in custom fields or mapped
          description: (user as any).description,
          themePreference: (user as any).themePreference,
          stripeConnect: (user as any).stripeConnect,
          agentPhoneNumber: (user as any).agentPhoneNumber,
          agentPhoneConfig: (user as any).agentPhoneConfig,
        };
      }
    } catch (e) {
      console.error("Failed to get user profile", e);
    }
    return null;
  },

  updateUserProfile: async (profile: Partial<UserProfile>): Promise<void> => {
    if (!currentUserUid) return;
    try {
      await updateUserProfileInFirestore(currentUserUid, {
        displayName: profile.displayName,
        photoURL: profile.photoURL,
        description: profile.description,
        themePreference: profile.themePreference,
        stripeConnect: profile.stripeConnect,
        agentPhoneNumber: profile.agentPhoneNumber,
        agentPhoneConfig: profile.agentPhoneConfig,
      });
      // Optionally update local cache if we had one, but for now we rely on Firestore
    } catch (e) {
      console.error("Failed to update user profile", e);
      throw e;
    }
  },

  uploadProfileImage: async (file: File): Promise<string> => {
    if (!currentUserUid) throw new Error("User not signed in");
    return await uploadProfileImageToStorage(currentUserUid, file);
  },

  clearCache: () => {
    projectCache.invalidateAll();
  },

  // Get projects from localStorage (for offline/immediate access)
  getLocalProjects: (): SavedProject[] => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const projects = JSON.parse(raw) as SavedProject[];
      return projects.sort((a, b) => b.lastModified - a.lastModified);
    } catch (e) {
      console.error("Failed to load projects", e);
      return [];
    }
  },

  // Get projects - prefers Firestore if user is logged in, falls back to localStorage
  getProjects: async (): Promise<SavedProject[]> => {
    if (currentUserUid) {
      try {
        const firestoreProjects = await getProjectsFromFirestore(currentUserUid);
        if (firestoreProjects.length > 0) {
          // Also update localStorage for offline access
          localStorage.setItem(STORAGE_KEY, JSON.stringify(firestoreProjects));
          return firestoreProjects;
        }
      } catch (e) {
        console.error("Failed to load from Firestore, using localStorage", e);
      }
    }
    return storageService.getLocalProjects();
  },

  // Sync local projects to Firestore (call after login)
  syncToFirestore: async () => {
    if (!currentUserUid) return;

    const localProjects = storageService.getLocalProjects();
    if (localProjects.length > 0) {
      try {
        await syncLocalStorageToFirestore(currentUserUid, localProjects);
        console.log("Local projects synced to Firestore");
      } catch (e) {
        console.error("Failed to sync to Firestore", e);
      }
    }
  },

  saveProject: async (report: ResearchReport): Promise<SavedProject> => {
    const projects = storageService.getLocalProjects();

    const newProject: SavedProject = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      lastModified: Date.now(),
      topic: report.topic,
      researchReport: report,
      websiteVersions: []
    };

    projects.unshift(newProject);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

    // Sync to Firestore if user is logged in
    if (currentUserUid) {
      try {
        await saveProjectToFirestore(currentUserUid, newProject);
      } catch (e) {
        console.error("Failed to save project to Firestore", e);
      }
    }

    return newProject;
  },

  // Synchronous version for backward compatibility
  createProject: (topic: string, report: ResearchReport): string => {
    const projects = storageService.getLocalProjects();

    const newProject: SavedProject = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      lastModified: Date.now(),
      topic: topic,
      researchReport: report,
      websiteVersions: []
    };

    projects.unshift(newProject);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

    // Async sync to Firestore
    if (currentUserUid) {
      saveProjectToFirestore(currentUserUid, newProject).catch(e =>
        console.error("Failed to save project to Firestore", e)
      );
    }

    return newProject.id;
  },

  updateProjectReport: async (projectId: string, report: ResearchReport) => {
    const projects = storageService.getLocalProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index !== -1) {
      projects[index].researchReport = report;
      projects[index].lastModified = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

      // Sync to Firestore
      if (currentUserUid) {
        try {
          await updateProjectInFirestore(currentUserUid, projectId, {
            researchReport: report,
            lastModified: Date.now()
          });
        } catch (e) {
          console.error("Failed to update project in Firestore", e);
        }
      }
    }
  },

  addWebsiteVersion: async (projectId: string, html: string, description: string): Promise<SavedProject | null> => {
    const projects = storageService.getLocalProjects();
    const index = projects.findIndex(p => p.id === projectId);

    if (index === -1) {
      // If project doesn't exist (e.g. built without research), create a fallback container
      const fallbackProject: SavedProject = {
        id: projectId,
        timestamp: Date.now(),
        lastModified: Date.now(),
        topic: "Direct Build Session",
        researchReport: {
          topic: "Direct Build",
          tldr: "Website built directly without prior research phase.",
          summary: "Website built without prior research report.",
          headerImagePrompt: "Abstract minimalist digital architecture visualization",
          dynamicSections: [],
          keyPoints: [],
          marketImplications: "",
          sources: []
        },
        websiteVersions: []
      };

      const newVersion: SavedWebsiteVersion = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        html,
        description
      };
      fallbackProject.websiteVersions.push(newVersion);
      projects.unshift(fallbackProject);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

      // Sync to Firestore
      if (currentUserUid) {
        saveProjectToFirestore(currentUserUid, fallbackProject).catch(e =>
          console.error("Failed to save fallback project to Firestore", e)
        );
      }

      return fallbackProject;
    }

    const version: SavedWebsiteVersion = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      html,
      description
    };

    projects[index].websiteVersions.unshift(version);
    projects[index].lastModified = Date.now();

    const [updatedProject] = projects.splice(index, 1);
    projects.unshift(updatedProject);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

    // Sync to Firestore
    if (currentUserUid) {
      try {
        await addWebsiteVersionToFirestore(currentUserUid, projectId, html, description);
      } catch (e) {
        console.error("Failed to add website version to Firestore", e);
      }
    }

    return updatedProject;
  },

  updateLatestWebsiteVersion: async (projectId: string, html: string) => {
    const projects = storageService.getLocalProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index !== -1 && projects[index].websiteVersions.length > 0) {
      projects[index].websiteVersions[0].html = html;
      projects[index].lastModified = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

      // Sync to Firestore
      if (currentUserUid) {
        try {
          await updateProjectInFirestore(currentUserUid, projectId, {
            websiteVersions: projects[index].websiteVersions,
            lastModified: Date.now()
          });
        } catch (e) {
          console.error("Failed to update website version in Firestore", e);
        }
      }
    }
  },

  deleteProject: async (id: string) => {
    const projects = storageService.getLocalProjects().filter(p => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

    // Sync to Firestore
    if (currentUserUid) {
      try {
        await deleteProjectFromFirestore(currentUserUid, id);
      } catch (e) {
        console.error("Failed to delete project from Firestore", e);
      }
    }
  },

  updateProjectTopic: async (id: string, newTopic: string) => {
    const projects = storageService.getLocalProjects();
    const project = projects.find(p => p.id === id);
    if (project) {
      project.topic = newTopic;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

      // Sync to Firestore
      if (currentUserUid) {
        try {
          await updateProjectInFirestore(currentUserUid, id, { topic: newTopic });
        } catch (e) {
          console.error("Failed to update project topic in Firestore", e);
        }
      }
    }
  },

  // ========== RESEARCH PROJECTS (Multi-Project Structure) ==========

  getLocalResearchProjects: (): ResearchProject[] => {
    try {
      const raw = localStorage.getItem(RESEARCH_PROJECTS_KEY);
      if (!raw) return [];
      const projects = JSON.parse(raw) as ResearchProject[];

      const byId = new Map<string, ResearchProject>();
      for (const project of projects) {
        if (!project || !project.id) continue;
        if (!byId.has(project.id)) {
          byId.set(project.id, project);
        }
      }

      const dedupedProjects: ResearchProject[] = Array.from(byId.values()).map(project => {
        const sessions = project.researchSessions || [];
        if (!sessions.length) return project;

        const bySessionId = new Map<string, SavedResearch>();
        for (const session of sessions) {
          if (!session || !session.id) continue;
          if (!bySessionId.has(session.id)) {
            bySessionId.set(session.id, session);
          }
        }

        const uniqueSessions = Array.from(bySessionId.values()).sort(
          (a, b) => b.timestamp - a.timestamp
        );

        return {
          ...project,
          researchSessions: uniqueSessions,
        };
      });

      const uniqueProjects = dedupedProjects.sort(
        (a, b) => b.lastModified - a.lastModified
      );

      if (uniqueProjects.length !== projects.length) {
        immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, uniqueProjects);
      }

      return uniqueProjects;
    } catch (e) {
      console.error("Failed to load research projects", e);
      return [];
    }
  },

  getResearchProjects: async (forceRefresh = false): Promise<ResearchProject[]> => {
    if (!forceRefresh) {
      const cached = projectCache.getProjectsIfFresh();
      if (cached) {
        return cached;
      }
    }

    if (currentUserUid) {
      try {
        const firestoreProjects = await getResearchProjectsFromFirestore(currentUserUid);
        const localProjects = storageService.getLocalResearchProjects();

        // Preserve "foreign" projects (where current user is not the owner) to support 
        // administrative "Jump In" access without them being wiped by a list refresh.
        const foreignProjects = localProjects.filter(p => p.ownerUid && p.ownerUid !== currentUserUid);
        const mergedProjects = [...firestoreProjects];

        // Add foreign projects if they aren't already in the list
        for (const foreign of foreignProjects) {
          if (!mergedProjects.some(p => p.id === foreign.id)) {
            mergedProjects.push(foreign);
          }
        }

        // Hydrate all projects with current user role and force admin if master email
        const userProfile = await storageService.getUserProfile();
        const isAdmin = userProfile?.email === 'contact.mngrm@gmail.com';

        const hydratedMerged = mergedProjects.map(p => ({
          ...p,
          currentUserRole: (isAdmin ? 'admin' : (p.currentUserRole || 'owner')) as ProjectAccessRole
        }));

        if (hydratedMerged.length > 0) {
          projectCache.setProjects(hydratedMerged);
          debouncedLocalStorageSave(RESEARCH_PROJECTS_KEY, hydratedMerged);
          try {
            localStorage.setItem(RESEARCH_PROJECTS_OWNER_KEY, currentUserUid);
          } catch (e) {
            console.warn('Failed to persist research projects owner uid to localStorage', e);
          }
          return hydratedMerged;
        }

        let ownerUid: string | null = null;
        try {
          ownerUid = localStorage.getItem(RESEARCH_PROJECTS_OWNER_KEY);
        } catch (e) {
          console.warn('Failed to read research projects owner uid from localStorage', e);
        }

        // Only treat local projects as belonging to this user if there is no recorded
        // owner yet or the owner matches the current Firebase uid.
        if (localProjects.length > 0 && (!ownerUid || ownerUid === currentUserUid)) {
          const syncPromises = localProjects.map(project =>
            createResearchProjectInFirestore(currentUserUid!, project).catch(e => {
              console.error(`Failed to sync project ${project.id}:`, e);
            })
          );
          await Promise.all(syncPromises);
          console.log(`Synced ${localProjects.length} local projects to Firestore for user`, currentUserUid);
          projectCache.setProjects(localProjects);
          debouncedLocalStorageSave(RESEARCH_PROJECTS_KEY, localProjects);
          try {
            localStorage.setItem(RESEARCH_PROJECTS_OWNER_KEY, currentUserUid);
          } catch (e) {
            console.warn('Failed to persist research projects owner uid to localStorage after sync', e);
          }
          return localProjects;
        }
      } catch (e) {
        console.error("Failed to load research projects from Firestore", e);
        const cachedFallback = projectCache.getProjects();
        if (cachedFallback) return cachedFallback;
      }
      return [];
    }

    // No authenticated user: fall back purely to localStorage for guest/legacy mode.
    const localProjects = storageService.getLocalResearchProjects();
    projectCache.setProjects(localProjects);
    return localProjects;
  },

  getResearchProject: async (projectId: string, ownerUidOverride?: string): Promise<ResearchProject | null> => {
    console.log("[StorageService] getResearchProject called for:", projectId, ownerUidOverride ? `(with owner override: ${ownerUidOverride})` : "");

    let project: ResearchProject | null = null;

    const cached = projectCache.getProject(projectId);
    if (cached) {
      // Check if cached sessions have full data (researchReport objects with actual content, not just references)
      const sessions = cached.researchSessions || [];
      const hasFullData = sessions.length === 0 || sessions.every(session => {
        // A full session has a researchReport object with actual content like tldr, keyPoints, etc.
        const report = session.researchReport;
        if (!report || typeof report !== 'object') return false;
        // Check for actual content - references only have tldr/summary as strings at the session level
        return report.keyPoints !== undefined || report.dynamicSections !== undefined || report.sources !== undefined;
      });

      if (hasFullData) {
        console.log("[StorageService] Cached project has full data, using as base.");
        project = cached;
      } else {
        console.log("[StorageService] Cached project has only references, fetching full data from Firestore...");
      }
    }

    if (!project && currentUserUid) {
      console.log("[StorageService] Fetching project from Firestore for user:", currentUserUid);
      try {
        const ownerUidForFetch = ownerUidOverride || (cached && cached.ownerUid) || currentUserUid;
        const projectFromFirestore = await getResearchProjectFromFirestore(ownerUidForFetch, projectId, true);
        if (projectFromFirestore) {
          project = {
            ...projectFromFirestore,
            ownerUid: projectFromFirestore.ownerUid || (cached && cached.ownerUid) || ownerUidForFetch,
          };
        }
      } catch (e) {
        console.error("[StorageService] Failed to get research project from Firestore", e);
      }
    }

    if (!project) {
      const localProjects = storageService.getLocalResearchProjects();
      project = localProjects.find(p => p.id === projectId) || null;
    }

    if (project) {
      // Hydrate with current user role and force admin if master email
      const userProfile = await storageService.getUserProfile();
      const isAdmin = userProfile?.email === 'contact.mngrm@gmail.com';
      const effectiveRole = isAdmin ? 'admin' : (project.currentUserRole || 'owner');

      const hydrated: ResearchProject = {
        ...project,
        currentUserRole: effectiveRole as ProjectAccessRole,
      };

      // Sync to localStorage so subsequent mutation functions (addTask, updateResearchProject, etc.)
      const localProjects = storageService.getLocalResearchProjects();
      const pIndex = localProjects.findIndex(p => p.id === projectId);
      if (pIndex !== -1) {
        localProjects[pIndex] = hydrated;
      } else {
        localProjects.push(hydrated);
      }
      immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, localProjects);

      // Fetch collaborator theme if applicable
      if (hydrated.ownerUid && hydrated.ownerUid !== currentUserUid && currentUserUid) {
        const viewerTheme = await getSharedProjectTheme(currentUserUid, projectId);
        if (viewerTheme) hydrated.theme = viewerTheme as any;
      }

      projectCache.setProject(hydrated);
      return hydrated;
    }
    return null;
  },

  createResearchProject: async (
    name: string,
    description: string,
    options?: { seoSeedKeywords?: string[]; agent?: { name: string; expertise: string; approach: string } },
  ): Promise<ResearchProject> => {
    const projects = storageService.getLocalResearchProjects();

    const newProject: ResearchProject = {
      id: crypto.randomUUID(),
      name,
      description,
      agent: options?.agent,
      createdAt: Date.now(),
      lastModified: Date.now(),
      researchSessions: [],
      draftResearchSessions: [],
      suggestedTopics: [],
      seoSeedKeywords: options?.seoSeedKeywords || [],
      tasks: [],
      notes: [],
      knowledgeBase: [],
      aiInsights: [],
      projectConversations: [],
      newsArticles: [],
      newsLastFetchedAt: undefined,
      pinnedAssetIds: [],
    };

    projects.unshift(newProject);

    // Force admin role for the master user
    const userProfile = await storageService.getUserProfile();
    const isAdmin = userProfile?.email === 'contact.mngrm@gmail.com';
    if (isAdmin) {
      newProject.currentUserRole = 'admin';
    }

    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(newProject);

    if (currentUserUid) {
      try {
        await createResearchProjectInFirestore(currentUserUid, newProject);
      } catch (e) {
        console.error("Failed to create research project in Firestore", e);
      }
    }

    return newProject;
  },

  duplicateResearchProject: async (projectId: string): Promise<ResearchProject> => {
    // Prefer a fully hydrated project (including complete research sessions) when duplicating,
    // so the copy preserves all sources, assets, and nested data used in the dashboard.
    let source: ResearchProject | null = null;

    try {
      source = await storageService.getResearchProject(projectId);
    } catch (e) {
      console.error("[StorageService] Failed to get full project for duplication, falling back to local copy", e);
    }

    if (!source) {
      const localProjects = storageService.getLocalResearchProjects();
      source = localProjects.find(p => p.id === projectId) || null;
    }

    if (!source) {
      throw new Error("Project not found");
    }

    const now = Date.now();
    const newId = crypto.randomUUID();

    // Deep clone the source project so nested structures (tasks, notes, sessions, files, etc.)
    // are not shared by reference between the original and the duplicate.
    const cloned: ResearchProject = JSON.parse(JSON.stringify(source));

    const originalSessions = cloned.researchSessions || [];
    const sessionIdMap = new Map<string, string>();

    const remappedSessions: SavedResearch[] = originalSessions.map((session) => {
      const oldId = session.id;
      const newSessionId = crypto.randomUUID();

      if (oldId) {
        sessionIdMap.set(oldId, newSessionId);
      }

      const remappedUploadedFiles = (session.uploadedFiles || []).map((file) => ({
        ...file,
        researchSessionId: newSessionId,
      }));

      const remappedConversations = (session.conversations || []).map((conv) => ({
        ...conv,
        sessionId: newSessionId,
      }));

      return {
        ...session,
        id: newSessionId,
        timestamp: session.timestamp || now,
        lastModified: session.lastModified || now,
        uploadedFiles: remappedUploadedFiles,
        conversations: remappedConversations,
      };
    });

    const remappedTasks = (cloned.tasks || []).map((task) => {
      if (task.sourceResearchId && sessionIdMap.has(task.sourceResearchId)) {
        return {
          ...task,
          sourceResearchId: sessionIdMap.get(task.sourceResearchId)!,
        };
      }
      return task;
    });

    const remappedNotes = (cloned.notes || []).map((note) => {
      if (note.linkedResearchId && sessionIdMap.has(note.linkedResearchId)) {
        return {
          ...note,
          linkedResearchId: sessionIdMap.get(note.linkedResearchId)!,
        };
      }
      return note;
    });

    const remappedKnowledgeBase = (cloned.knowledgeBase || []).map((file) => {
      if (file.researchSessionId && sessionIdMap.has(file.researchSessionId)) {
        return {
          ...file,
          researchSessionId: sessionIdMap.get(file.researchSessionId)!,
        };
      }
      return file;
    });

    const remappedProjectConversations = (cloned.projectConversations || []).map((conv) => {
      if (conv.sessionId && sessionIdMap.has(conv.sessionId)) {
        return {
          ...conv,
          sessionId: sessionIdMap.get(conv.sessionId)!,
        };
      }
      return conv;
    });

    // Basic name suffix to indicate duplication
    const baseName = cloned.name || 'Untitled Project';
    const duplicatedName = baseName.endsWith(' (Copy)') ? `${baseName}` : `${baseName} (Copy)`;

    // Force admin role for the master user
    const userProfile = await storageService.getUserProfile();
    const isAdmin = userProfile?.email === 'contact.mngrm@gmail.com';

    // Local representation keeps full sessions so the dashboard has all context immediately.
    const duplicated: ResearchProject = {
      ...cloned,
      id: newId,
      name: duplicatedName,
      createdAt: now,
      lastModified: now,
      ownerUid: currentUserUid || cloned.ownerUid,
      // Start the duplicate as an unshared project; collaborators can be re-added explicitly.
      collaborators: [],
      currentUserRole: isAdmin ? 'admin' : (currentUserUid ? 'owner' : cloned.currentUserRole),
      activeResearchTopic: null,
      activeResearchStartedAt: null,
      activeResearchStatus: null,
      researchSessions: remappedSessions,
      tasks: remappedTasks,
      notes: remappedNotes,
      knowledgeBase: remappedKnowledgeBase,
      projectConversations: remappedProjectConversations,
    };

    // Insert the duplicated project at the top of the local list.
    const projects = storageService.getLocalResearchProjects();
    const updatedProjects = [duplicated, ...projects];
    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, updatedProjects);
    projectCache.setProject(duplicated);
    projectCache.setProjects(updatedProjects);

    // Mirror the duplicate into Firestore for signed-in users.
    if (currentUserUid) {
      try {
        // 1) Create a lightweight project document without embedding full research sessions,
        // to avoid nested-entity limits. Sessions will be cloned via the subcollection API.
        const { researchSessions: _, ownerUid: __, collaborators: ___, currentUserRole: ____, ...rest } = duplicated;
        const baseForFirestore: ResearchProject = {
          ...(rest as ResearchProject),
          // Let Firestore helper assign ownerUid and collaborators defaults.
          researchSessions: [],
        };

        await createResearchProjectInFirestore(currentUserUid, baseForFirestore);

        // 2) Clone each research session into the new project's sessions subcollection and
        // reference array, using fresh session IDs for the duplicate.
        for (const session of remappedSessions) {
          const sessionClone: SavedResearch = {
            ...session,
            timestamp: session.timestamp || now,
            lastModified: session.lastModified || now,
          };
          await addResearchSessionToProject(currentUserUid, newId, sessionClone);
        }
      } catch (e) {
        console.error("Failed to duplicate research project in Firestore", e);
      }
    }

    return duplicated;
  },

  addProjectCollaboratorByEmail: async (
    projectId: string,
    email: string,
    role: 'editor' | 'viewer'
  ): Promise<ResearchProject> => {
    if (!currentUserUid) {
      throw new Error("You must be signed in to share projects.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error("Email is required.");
    }

    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      throw new Error("Project not found");
    }

    const project = projects[index];
    const ownerUid = project.ownerUid || currentUserUid;
    if (ownerUid !== currentUserUid) {
      throw new Error("Only the project owner can share this project.");
    }

    const targetUser = await findUserByEmailInFirestore(normalizedEmail);
    if (!targetUser) {
      throw new Error("No user found with that email.");
    }

    if (targetUser.uid === ownerUid) {
      throw new Error("You are already the owner of this project.");
    }

    const existing = project.collaborators || [];
    if (existing.some(c => c.uid === targetUser.uid)) {
      throw new Error("User is already a collaborator on this project.");
    }

    const now = Date.now();
    const newCollab: ProjectCollaborator = {
      uid: targetUser.uid,
      email: targetUser.email || normalizedEmail,
      role,
      addedAt: now,
    };

    const updatedProject: ResearchProject = {
      ...project,
      ownerUid,
      collaborators: [...existing, newCollab],
      lastModified: now,
    };

    projects[index] = updatedProject;
    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(updatedProject);
    projectCache.setProjects(projects);

    try {
      await updateResearchProjectInFirestore(ownerUid, projectId, {
        ownerUid,
        collaborators: updatedProject.collaborators,
      });
      await upsertSharedProjectRef(targetUser.uid, ownerUid, projectId, role);
    } catch (e) {
      console.error("Failed to update collaborators in Firestore", e);
    }

    return updatedProject;
  },

  removeProjectCollaborator: async (
    projectId: string,
    collaboratorUid: string
  ): Promise<ResearchProject | null> => {
    if (!currentUserUid) {
      throw new Error("You must be signed in to modify collaborators.");
    }

    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      return null;
    }

    const project = projects[index];
    const ownerUid = project.ownerUid || currentUserUid;
    if (ownerUid !== currentUserUid) {
      throw new Error("Only the project owner can modify collaborators.");
    }

    const existing = project.collaborators || [];
    const updatedCollaborators = existing.filter(c => c.uid !== collaboratorUid);
    const now = Date.now();

    const updatedProject: ResearchProject = {
      ...project,
      collaborators: updatedCollaborators,
      lastModified: now,
    };

    projects[index] = updatedProject;
    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(updatedProject);
    projectCache.setProjects(projects);

    try {
      await updateResearchProjectInFirestore(ownerUid, projectId, {
        collaborators: updatedCollaborators,
      });
      await removeSharedProjectRef(collaboratorUid, projectId);
    } catch (e) {
      console.error("Failed to remove collaborator in Firestore", e);
    }

    return updatedProject;
  },

  updateResearchProject: async (projectId: string, updates: Partial<ResearchProject>): Promise<void> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      return;
    }
    const updatedProject: ResearchProject = {
      ...projects[index],
      ...updates,
      lastModified: Date.now()
    };
    projects[index] = updatedProject;
    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(updatedProject);

    if (currentUserUid) {
      try {
        const ownerUid = updatedProject.ownerUid || currentUserUid;
        let firestoreUpdates: Partial<ResearchProject> = updates;

        // Firestore does not support nested arrays. Full sessions can contain nested
        // arrays (websiteVersions, noteMapState, etc.), so only persist lightweight
        // references on the project document.
        if (updates.researchSessions) {
          firestoreUpdates = {
            ...updates,
            researchSessions: updates.researchSessions.map((session: any) => {
              const topic =
                (typeof session?.topic === 'string' && session.topic) ||
                (typeof session?.researchReport?.topic === 'string' && session.researchReport.topic) ||
                'Untitled Session';

              const report = session?.researchReport;
              const tldr =
                (typeof report?.tldr === 'string' && report.tldr) ||
                (typeof session?.tldr === 'string' && session.tldr) ||
                '';

              const summary =
                (typeof report?.summary === 'string' && report.summary) ||
                (typeof session?.summary === 'string' && session.summary) ||
                '';

              return {
                id: String(session?.id || ''),
                timestamp: typeof session?.timestamp === 'number' ? session.timestamp : Date.now(),
                lastModified: typeof session?.lastModified === 'number' ? session.lastModified : Date.now(),
                topic,
                tldr: tldr.substring(0, 500),
                summary: summary.substring(0, 1000),
                isStale: Boolean(session?.isStale),
              };
            }) as any,
          };
        }

        // Tables also contain nested arrays (rows is an array of arrays).
        // Serialize rows to JSON string to avoid Firestore nested array limitation.
        if (updates.tables) {
          firestoreUpdates = {
            ...firestoreUpdates,
            tables: updates.tables.map((table: any) => ({
              id: String(table?.id || ''),
              title: String(table?.title || ''),
              description: table?.description ? String(table.description) : undefined,
              columns: Array.isArray(table?.columns) ? table.columns : [],
              rows: JSON.stringify(Array.isArray(table?.rows) ? table.rows : []),
              createdAt: typeof table?.createdAt === 'number' ? table.createdAt : Date.now(),
              googleSpreadsheetId: table?.googleSpreadsheetId,
              googleSheetTitle: table?.googleSheetTitle,
            })) as any,
          };
        }

        // If 'theme' is being updated and we are NOT the owner, update our private
        // shared project reference instead of the global project doc.
        if (updates.theme !== undefined && updatedProject.ownerUid && updatedProject.ownerUid !== currentUserUid) {
          // If ONLY theme is updating, we're done here.
          // If other things are updating (e.g. tasks), we might need to *also* update the main doc via API if allowed.
          // But usually cycleTheme only updates theme.
          await updateSharedProjectThemeInFirestore(currentUserUid, projectId, updates.theme || null);

          // If there are other updates besides theme, we might still want to try pushing them to the owner.
          // But for now, let's assume mixed updates are rare or handled by separate calls.
          // If we want to be safe: remove 'theme' from firestoreUpdates and push the rest.
          const { theme, ...restUpdates } = firestoreUpdates;
          if (Object.keys(restUpdates).length > 0) {
            await updateResearchProjectInFirestore(ownerUid, projectId, restUpdates);
          }
        } else {
          await updateResearchProjectInFirestore(ownerUid, projectId, firestoreUpdates);
        }
      } catch (e) {
        console.error("Failed to update research project in Firestore", e);
      }
    }
  },

  addTask: async (
    projectId: string,
    input: {
      title: string;
      description?: string;
      status: TaskStatus;
      priority: TaskPriority;
      aiGenerated?: boolean;
      sourceResearchId?: string;
      tags?: string[];
    }
  ): Promise<ProjectTask> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      throw new Error("Project not found");
    }

    const now = Date.now();
    const existingTasks = projects[index].tasks || [];
    const statusTasks = existingTasks.filter(t => t.status === input.status);

    const newTask: ProjectTask = {
      id: crypto.randomUUID(),
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      order: statusTasks.length,
      createdAt: now,
      lastModified: now,
      dueDate: undefined,
      aiGenerated: input.aiGenerated,
      sourceResearchId: input.sourceResearchId,
      tags: input.tags
    };

    const updatedTasks = [...existingTasks, newTask];
    projects[index] = {
      ...projects[index],
      tasks: updatedTasks,
      lastModified: now
    };

    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(projects[index]);

    if (currentUserUid) {
      try {
        const ownerUid = projects[index].ownerUid || currentUserUid;
        await updateProjectTasksInFirestore(ownerUid, projectId, updatedTasks);
      } catch (e) {
        console.error("Failed to update tasks in Firestore", e);
      }
    }

    return newTask;
  },

  reorderTasks: async (projectId: string, tasks: ProjectTask[]): Promise<void> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      return;
    }

    const now = Date.now();
    projects[index] = {
      ...projects[index],
      tasks,
      lastModified: now
    };

    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(projects[index]);

    if (currentUserUid) {
      try {
        const ownerUid = projects[index].ownerUid || currentUserUid;
        await updateProjectTasksInFirestore(ownerUid, projectId, tasks);
      } catch (e) {
        console.error("Failed to reorder tasks in Firestore", e);
      }
    }
  },

  updateTask: async (
    projectId: string,
    taskId: string,
    updates: Partial<ProjectTask>
  ): Promise<void> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      return;
    }

    const existingTasks = projects[index].tasks || [];
    const now = Date.now();
    const updatedTasks = existingTasks.map(task =>
      task.id === taskId
        ? { ...task, ...updates, lastModified: now }
        : task
    );

    projects[index] = {
      ...projects[index],
      tasks: updatedTasks,
      lastModified: now
    };

    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(projects[index]);

    if (currentUserUid) {
      try {
        const ownerUid = projects[index].ownerUid || currentUserUid;
        await updateProjectTasksInFirestore(ownerUid, projectId, updatedTasks);
      } catch (e) {
        console.error("Failed to update task in Firestore", e);
      }
    }
  },

  deleteTask: async (projectId: string, taskId: string): Promise<void> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      return;
    }

    const existingTasks = projects[index].tasks || [];
    const remaining = existingTasks.filter(task => task.id !== taskId);

    const statuses: TaskStatus[] = ['todo', 'in_progress', 'done'];
    const reordered: ProjectTask[] = [];

    statuses.forEach(status => {
      const column = remaining
        .filter(task => task.status === status)
        .sort((a, b) => a.order - b.order);
      column.forEach((task, order) => {
        reordered.push({ ...task, order });
      });
    });

    const now = Date.now();
    projects[index] = {
      ...projects[index],
      tasks: reordered,
      lastModified: now
    };

    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(projects[index]);

    if (currentUserUid) {
      try {
        const ownerUid = projects[index].ownerUid || currentUserUid;
        await updateProjectTasksInFirestore(ownerUid, projectId, reordered);
      } catch (e) {
        console.error("Failed to delete task in Firestore", e);
      }
    }
  },

  addNote: async (
    projectId: string,
    input: {
      title: string;
      content: string;
      color?: string;
      pinned?: boolean;
      aiGenerated?: boolean;
      aiSuggestions?: string[];
      tags?: string[];
      linkedResearchId?: string;
    }
  ): Promise<ProjectNote> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      throw new Error("Project not found");
    }

    const now = Date.now();
    const existingNotes = projects[index].notes || [];

    const newNote: ProjectNote = {
      id: crypto.randomUUID(),
      title: input.title,
      content: input.content,
      createdAt: now,
      lastModified: now,
      color: input.color,
      pinned: input.pinned,
      aiGenerated: input.aiGenerated,
      aiSuggestions: input.aiSuggestions,
      tags: input.tags,
      linkedResearchId: input.linkedResearchId
    };

    const updatedNotes = [...existingNotes, newNote];

    projects[index] = {
      ...projects[index],
      notes: updatedNotes,
      lastModified: now
    };

    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(projects[index]);

    if (currentUserUid) {
      try {
        const ownerUid = projects[index].ownerUid || currentUserUid;
        await updateProjectNotesInFirestore(ownerUid, projectId, updatedNotes);
      } catch (e) {
        console.error("Failed to update notes in Firestore", e);
      }
    }

    return newNote;
  },

  updateNote: async (
    projectId: string,
    noteId: string,
    updates: Partial<ProjectNote>
  ): Promise<void> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      return;
    }

    const existingNotes = projects[index].notes || [];
    const now = Date.now();
    const updatedNotes = existingNotes.map(note =>
      note.id === noteId
        ? { ...note, ...updates, lastModified: updates.lastModified ?? now }
        : note
    );

    projects[index] = {
      ...projects[index],
      notes: updatedNotes,
      lastModified: now
    };

    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(projects[index]);

    if (currentUserUid) {
      try {
        const ownerUid = projects[index].ownerUid || currentUserUid;
        await updateProjectNotesInFirestore(ownerUid, projectId, updatedNotes);
      } catch (e) {
        console.error("Failed to update note in Firestore", e);
      }
    }
  },

  deleteNote: async (projectId: string, noteId: string): Promise<void> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      return;
    }

    const existingNotes = projects[index].notes || [];
    const updatedNotes = existingNotes.filter(note => note.id !== noteId);
    const now = Date.now();

    projects[index] = {
      ...projects[index],
      notes: updatedNotes,
      lastModified: now
    };

    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(projects[index]);

    if (currentUserUid) {
      try {
        const ownerUid = projects[index].ownerUid || currentUserUid;
        await updateProjectNotesInFirestore(ownerUid, projectId, updatedNotes);
      } catch (e) {
        console.error("Failed to delete note in Firestore", e);
      }
    }
  },

  addResearchToProject: async (projectId: string, report: ResearchReport): Promise<SavedResearch> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      throw new Error("Project not found");
    }

    const now = Date.now();
    const session: SavedResearch = {
      id: crypto.randomUUID(),
      timestamp: now,
      lastModified: now,
      topic: report.topic,
      researchReport: report,
      websiteVersions: [],
      noteMapState: [],
      uploadedFiles: [],
      conversations: [],
      aiThinking: [],
      assetCaptions: []
    };

    const existingSessions = projects[index].researchSessions || [];
    const updatedSessions = [session, ...existingSessions];

    const updatedProject: ResearchProject = {
      ...projects[index],
      researchSessions: updatedSessions,
      lastModified: now
    };

    projects[index] = updatedProject;
    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(updatedProject);

    console.log('[StorageService] addResearchToProject: Saved to localStorage, now saving to Firestore...', {
      projectId,
      sessionId: session.id,
      topic: session.topic
    });

    if (currentUserUid) {
      try {
        const ownerUid = updatedProject.ownerUid || currentUserUid;
        await addResearchSessionToProject(ownerUid, projectId, session);
        console.log('[StorageService] ✅ Research session successfully saved to Firestore:', session.id);
      } catch (e) {
        console.error("[StorageService] ❌ Failed to add research session to Firestore:", e);
        // Don't throw - localStorage save succeeded, which is essential.
        // User can still access their research, and we'll retry on next sync.
        console.warn('[StorageService] Session saved to localStorage only. Will retry Firestore sync later.');
      }
    } else {
      console.warn('[StorageService] No user logged in - session saved to localStorage only');
    }

    return session;
  },

  updateResearchInProject: async (
    projectId: string,
    sessionId: string,
    updates: Partial<SavedResearch>
  ): Promise<void> => {
    await storageService.updateResearchSession(projectId, sessionId, updates);
  },

  createShareLinkForResearchSession: async (
    projectId: string,
    sessionId: string,
    report: ResearchReport
  ): Promise<string> => {
    if (!currentUserUid) {
      throw new Error('You must be signed in to share a report');
    }

    const shareId = await createSharedResearchReportInFirestore(
      currentUserUid,
      projectId,
      sessionId,
      report
    );

    try {
      await storageService.updateResearchSession(projectId, sessionId, { shareId });
    } catch (e) {
      console.error('Failed to persist shareId onto research session', e);
    }

    return shareId;
  },

  getSharedResearchReport: async (
    shareId: string
  ): Promise<{ report: ResearchReport; meta: any } | null> => {
    return getSharedResearchReportFromFirestore(shareId);
  },

  deleteResearchFromProject: async (projectId: string, sessionId: string): Promise<void> => {
    const projects = storageService.getLocalResearchProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index === -1) {
      return;
    }

    const existingSessions = projects[index].researchSessions || [];
    const updatedSessions = existingSessions.filter(session => session.id !== sessionId);
    const now = Date.now();

    const updatedProject: ResearchProject = {
      ...projects[index],
      researchSessions: updatedSessions,
      lastModified: now
    };

    projects[index] = updatedProject;
    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.setProject(updatedProject);

    if (currentUserUid) {
      try {
        const ownerUid = updatedProject.ownerUid || currentUserUid;
        await deleteResearchSessionFromProject(ownerUid, projectId, sessionId);
      } catch (e) {
        console.error("Failed to delete research session from Firestore", e);
      }
    }
  },

  deleteResearchProject: async (projectId: string): Promise<void> => {
    const allProjects = storageService.getLocalResearchProjects();
    const projectToDelete = allProjects.find(p => p.id === projectId) || null;
    const projects = allProjects.filter(p => p.id !== projectId);
    immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
    projectCache.invalidateProject(projectId);

    if (currentUserUid) {
      try {
        const ownerUid = (projectToDelete && projectToDelete.ownerUid) || currentUserUid;
        await deleteResearchProjectFromFirestore(ownerUid, projectId);
      } catch (e) {
        console.error("Failed to delete research project from Firestore", e);
      }
    }
  },

  syncProjectToFirestore: async (project: ResearchProject): Promise<void> => {
    if (!currentUserUid) {
      console.warn("No user logged in, cannot sync to Firestore");
      return;
    }

    try {
      const ownerUid = project.ownerUid || currentUserUid;
      await updateResearchProjectInFirestore(ownerUid, project.id, {
        name: project.name,
        description: project.description,
        researchSessions: project.researchSessions,
        draftResearchSessions: project.draftResearchSessions,
        suggestedTopics: project.suggestedTopics,
        tasks: project.tasks,
        notes: project.notes,
        aiInsights: project.aiInsights,
        activeResearchTopic: project.activeResearchTopic,
        activeResearchStartedAt: project.activeResearchStartedAt,
        activeResearchStatus: project.activeResearchStatus,
        worlds: project.worlds || [],
      });
      console.log("Project fully synced to Firestore:", project.id);
    } catch (e) {
      console.error("Failed to sync project to Firestore", e);
    }
  },

  syncAllProjectsToFirestore: async (): Promise<void> => {
    if (!currentUserUid) {
      console.warn("No user logged in, cannot sync to Firestore");
      return;
    }

    const projects = storageService.getLocalResearchProjects();
    for (const project of projects) {
      await storageService.syncProjectToFirestore(project);
    }
  },

  repairResearchProjectFromFirestore: async (projectId: string): Promise<ResearchProject | null> => {
    if (!currentUserUid) {
      console.warn("No user logged in, cannot repair project from Firestore");
      return null;
    }

    try {
      const localProjects = storageService.getLocalResearchProjects();
      const localProject = localProjects.find(p => p.id === projectId) || null;
      const ownerUid = (localProject && localProject.ownerUid) || currentUserUid;

      const project = await getResearchProjectFromFirestore(ownerUid, projectId, true);
      if (!project) {
        console.warn("Project not found in Firestore for repair:", projectId);
        return null;
      }

      const projects = storageService.getLocalResearchProjects();
      const index = projects.findIndex(p => p.id === projectId);
      const updatedProject: ResearchProject = {
        ...project,
        lastModified: project.lastModified || Date.now(),
      };

      if (index === -1) {
        projects.unshift(updatedProject);
      } else {
        projects[index] = updatedProject;
      }

      immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, projects);
      projectCache.setProject(updatedProject);
      projectCache.setProjects(projects);

      return updatedProject;
    } catch (e) {
      console.error("[StorageService] Failed to repair research project from Firestore", e);
      return null;
    }
  },

  repairAllResearchProjectsFromFirestore: async (): Promise<void> => {
    if (!currentUserUid) {
      console.warn("No user logged in, cannot repair projects from Firestore");
      return;
    }

    try {
      const firestoreProjects = await getResearchProjectsFromFirestore(currentUserUid);
      const repaired: ResearchProject[] = [];

      for (const p of firestoreProjects) {
        const ownerUid = p.ownerUid || currentUserUid;
        const full = await getResearchProjectFromFirestore(ownerUid, p.id, true);
        if (full) {
          const repairedProject: ResearchProject = {
            ...full,
            currentUserRole: p.currentUserRole,
          };
          repaired.push(repairedProject);
        }
      }

      if (repaired.length === 0) {
        return;
      }

      immediateLocalStorageSave(RESEARCH_PROJECTS_KEY, repaired);
      projectCache.setProjects(repaired);
      for (const project of repaired) {
        projectCache.setProject(project);
      }
    } catch (e) {
      console.error("[StorageService] Failed to repair all research projects from Firestore", e);
    }
  },

  // ========== KNOWLEDGE BASE (VERCEL BLOB-BACKED WITH LOCAL FALLBACK) ==========

  uploadKnowledgeBaseFile: async (projectId: string, file: File, researchSessionId?: string, options?: { skipIndexing?: boolean }): Promise<KnowledgeBaseFile> => {
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const safeName = file.name || `asset-${fileId}`;
    const contentType = file.type || 'application/octet-stream';

    // Use client-side upload to bypass serverless function payload limits (4.5MB)
    // This uploads directly from browser to Vercel Blob storage
    try {
      // Dynamic import to avoid bundling issues
      const { upload } = await import('@vercel/blob/client');

      const pathname = `projects/${projectId}/${safeName}`;

      console.log('[Blob Upload] Starting client-side upload:', safeName, 'size:', file.size);

      const blob = await upload(pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/media?op=upload-token',
      });

      console.log('[Blob Upload] Success:', blob.url);

      const knowledgeFile: KnowledgeBaseFile = {
        id: fileId,
        name: safeName,
        type: contentType,
        size: file.size,
        url: blob.url,
        storagePath: blob.pathname,
        uploadedAt: Date.now(),
        researchSessionId,
      };

      // Log activity
      await logProjectActivity(projectId, projectId, // Note: ownerUid might be projectId if not joined, but usually we should get ownerUid
        'file_uploaded',
        `uploaded file "${safeName}"`,
        { fileId, fileName: safeName, fileSize: file.size }
      );

      if (!options?.skipIndexing) {
        try {
          const result = await indexKnowledgeBaseFileToFileSearch({
            projectId,
            kbFileId: knowledgeFile.id,
            displayName: knowledgeFile.name,
            mimeType: knowledgeFile.type,
            file,
          });
          if (result.documentName) {
            knowledgeFile.fileSearchDocumentName = result.documentName;
            knowledgeFile.fileSearchIndexedAt = Date.now();
          }
        } catch (e: any) {
          knowledgeFile.fileSearchIndexError = String(e?.message || e);
        }
      }

      return knowledgeFile;
    } catch (error) {
      console.error('uploadKnowledgeBaseFile: client-side upload failed, falling back to local blob URL', error);

      // Fallback: local-only blob URL so the UI continues to function in dev or
      // when the Blob API is temporarily unavailable.
      const objectUrl = URL.createObjectURL(file);

      const knowledgeFile: KnowledgeBaseFile = {
        id: fileId,
        name: safeName,
        type: contentType,
        size: file.size,
        url: objectUrl,
        storagePath: '',
        uploadedAt: Date.now(),
        researchSessionId,
      };

      if (!options?.skipIndexing) {
        try {
          const result = await indexKnowledgeBaseFileToFileSearch({
            projectId,
            kbFileId: knowledgeFile.id,
            displayName: knowledgeFile.name,
            mimeType: knowledgeFile.type,
            file,
          });
          if (result.documentName) {
            knowledgeFile.fileSearchDocumentName = result.documentName;
            knowledgeFile.fileSearchIndexedAt = Date.now();
          }
        } catch (e: any) {
          knowledgeFile.fileSearchIndexError = String(e?.message || e);
        }
      }

      return knowledgeFile;
    }
  },

  deleteKnowledgeBaseFile: async (projectId: string, file: KnowledgeBaseFile): Promise<void> => {
    // Best-effort cleanup on the backing Blob store when we know the pathname.
    try {
      if (file.storagePath) {
        await authFetch('/api/media?op=delete-blob', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pathname: file.storagePath }),
        });

        // Log activity
        await logProjectActivity(projectId, projectId,
          'file_deleted',
          `deleted file "${file.name}"`,
          { fileId: file.id, fileName: file.name }
        );
      }
    } catch (e) {
      console.error('Failed to delete knowledge base file from Blob store', e);
    }

    // Always revoke any local object URLs to avoid leaking browser memory.
    try {
      if (file.url && file.url.startsWith('blob:')) {
        URL.revokeObjectURL(file.url);
      }
    } catch (e) {
      console.error('Failed to revoke local knowledge base file URL', e);
    }
  },

  updateResearchSession: async (projectId: string, sessionId: string, updates: Partial<SavedResearch>): Promise<void> => {
    const projects = storageService.getLocalResearchProjects();
    const projectIndex = projects.findIndex(p => p.id === projectId);

    if (projectIndex !== -1) {
      const sessionIndex = projects[projectIndex].researchSessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        projects[projectIndex].researchSessions[sessionIndex] = {
          ...projects[projectIndex].researchSessions[sessionIndex],
          ...updates,
          lastModified: Date.now()
        };
        projects[projectIndex].lastModified = Date.now();
        localStorage.setItem(RESEARCH_PROJECTS_KEY, JSON.stringify(projects));

        projectCache.setProject(projects[projectIndex]);

        if (currentUserUid) {
          try {
            const ownerUid = projects[projectIndex].ownerUid || currentUserUid;
            await updateResearchSessionInProject(
              ownerUid,
              projectId,
              sessionId,
              projects[projectIndex].researchSessions[sessionIndex]
            );
          } catch (e) {
            console.error("Failed to update research session in Firestore", e);
          }
        }
      }
    }
  },

  getProjectKnowledgeBaseContext: (project: ResearchProject): string => {
    const projectFiles = project.knowledgeBase || [];
    const researchFiles: KnowledgeBaseFile[] = [];

    project.researchSessions.forEach(session => {
      if (session.uploadedFiles) {
        researchFiles.push(...session.uploadedFiles);
      }
    });

    const allFiles = [...projectFiles, ...researchFiles];

    if (allFiles.length === 0) return '';

    let context = '\n\n---\nKNOWLEDGE BASE CONTEXT (User-provided reference materials):\n';

    allFiles.forEach((file, index) => {
      if (file.extractedText || file.summary) {
        context += `\n[File ${index + 1}: ${file.name}]\n`;
        context += file.extractedText || file.summary || '';
        context += '\n';
      }
    });

    context += '---\n';

    return context;
  },

  getPhoneAgentLeads: async (): Promise<any[]> => {
    if (!currentUserUid) return [];
    return await getPhoneAgentLeads(currentUserUid);
  },

  deletePhoneAgentLead: async (leadId: string): Promise<void> => {
    if (!currentUserUid) return;
    return await deletePhoneAgentLead(currentUserUid, leadId);
  },

  // ─── Note Mode phone agent notes ───────────────────────────────────────────
  getPhoneAgentNotes: async (): Promise<any[]> => {
    if (!currentUserUid) return [];
    return await getPhoneAgentNotes(currentUserUid);
  },

  savePhoneAgentNote: async (note: { body: string; from: string; timestamp: number }): Promise<string> => {
    if (!currentUserUid) throw new Error('Not signed in');
    return await savePhoneAgentNote(currentUserUid, note);
  },

  deletePhoneAgentNote: async (noteId: string): Promise<void> => {
    if (!currentUserUid) return;
    return await deletePhoneAgentNote(currentUserUid, noteId);
  }
};
