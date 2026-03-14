import { ResearchProject, SavedResearch } from '../types.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

const CACHE_TTL = 5 * 60 * 1000;
const STALE_TTL = 30 * 1000;

class ProjectCache {
  private projectsCache: CacheEntry<ResearchProject[]> | null = null;
  private projectCache: Map<string, CacheEntry<ResearchProject>> = new Map();
  private pendingWrites: Map<string, NodeJS.Timeout> = new Map();
  private writeQueue: Map<string, Partial<ResearchProject>> = new Map();

  setProjects(projects: ResearchProject[]): void {
    this.projectsCache = {
      data: projects,
      timestamp: Date.now(),
      expiresAt: Date.now() + CACHE_TTL
    };
    projects.forEach(p => this.setProject(p));
  }

  getProjects(): ResearchProject[] | null {
    if (!this.projectsCache) return null;
    if (Date.now() > this.projectsCache.expiresAt) {
      this.projectsCache = null;
      return null;
    }
    return this.projectsCache.data;
  }

  getProjectsIfFresh(): ResearchProject[] | null {
    if (!this.projectsCache) return null;
    if (Date.now() > this.projectsCache.timestamp + STALE_TTL) return null;
    return this.projectsCache.data;
  }

  setProject(project: ResearchProject): void {
    this.projectCache.set(project.id, {
      data: project,
      timestamp: Date.now(),
      expiresAt: Date.now() + CACHE_TTL
    });
    
    if (this.projectsCache) {
      const index = this.projectsCache.data.findIndex(p => p.id === project.id);
      if (index !== -1) {
        this.projectsCache.data[index] = project;
      } else {
        this.projectsCache.data.unshift(project);
      }
      this.projectsCache.data.sort((a, b) => b.lastModified - a.lastModified);
    }
  }

  getProject(projectId: string): ResearchProject | null {
    const entry = this.projectCache.get(projectId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.projectCache.delete(projectId);
      return null;
    }
    return entry.data;
  }

  invalidateProject(projectId: string): void {
    this.projectCache.delete(projectId);
    if (this.projectsCache) {
      this.projectsCache.data = this.projectsCache.data.filter(p => p.id !== projectId);
    }
  }

  invalidateAll(): void {
    this.projectsCache = null;
    this.projectCache.clear();
  }

  queueWrite(
    projectId: string, 
    updates: Partial<ResearchProject>, 
    writeCallback: () => Promise<void>
  ): void {
    const existingUpdates = this.writeQueue.get(projectId) || {};
    this.writeQueue.set(projectId, { ...existingUpdates, ...updates });
    
    const existingTimeout = this.pendingWrites.get(projectId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    const timeout = setTimeout(async () => {
      this.pendingWrites.delete(projectId);
      this.writeQueue.delete(projectId);
      try {
        await writeCallback();
      } catch (e) {
        console.error('Debounced write failed:', e);
      }
    }, 500);
    
    this.pendingWrites.set(projectId, timeout);
  }

  async flushWrites(): Promise<void> {
    const writePromises: Promise<void>[] = [];
    
    this.pendingWrites.forEach((timeout, projectId) => {
      clearTimeout(timeout);
    });
    
    this.pendingWrites.clear();
    this.writeQueue.clear();
  }

  updateProjectInCache(projectId: string, updates: Partial<ResearchProject>): void {
    const cached = this.getProject(projectId);
    if (cached) {
      this.setProject({ ...cached, ...updates, lastModified: Date.now() });
    }
  }

  addResearchToCache(projectId: string, research: SavedResearch): void {
    const cached = this.getProject(projectId);
    if (cached) {
      const updated = {
        ...cached,
        researchSessions: [research, ...cached.researchSessions],
        lastModified: Date.now()
      };
      this.setProject(updated);
    }
  }

  getStats(): { projectCount: number; cacheHits: number; cacheSize: number } {
    return {
      projectCount: this.projectCache.size,
      cacheHits: this.projectsCache ? 1 : 0,
      cacheSize: this.projectCache.size + (this.projectsCache ? 1 : 0)
    };
  }
}

export const projectCache = new ProjectCache();
