import { db } from './firebase';
import {
  collection, doc, getDocs, getDoc, setDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { AssistantVersion } from '../types';

const versionsCol = (userId: string) =>
  collection(db, 'users', userId, 'assistant_versions');

export const assistantVersionService = {

  /** List all versions for a specific project */
  getVersionsForProject: async (
    userId: string,
    projectId: string
  ): Promise<AssistantVersion[]> => {
    try {
      const q = query(versionsCol(userId), where('projectId', '==', projectId), orderBy('updatedAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as AssistantVersion));
    } catch (e) {
      console.error('[assistantVersionService] getVersionsForProject error:', e);
      return [];
    }
  },

  /** Get the currently active version for a project (if any) */
  getActiveVersion: async (
    userId: string,
    projectId: string
  ): Promise<AssistantVersion | null> => {
    try {
      const q = query(
        versionsCol(userId),
        where('projectId', '==', projectId),
        where('isActive', '==', true)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() } as AssistantVersion;
    } catch (e) {
      console.error('[assistantVersionService] getActiveVersion error:', e);
      return null;
    }
  },

  /** Save (create or update) a version */
  saveVersion: async (
    userId: string,
    version: Partial<AssistantVersion> & { projectId: string; name: string }
  ): Promise<string> => {
    const id = version.id || `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ref = doc(versionsCol(userId), id);
    await setDoc(ref, {
      ...version,
      id,
      plugins: version.plugins ?? {},
      installedApis: version.installedApis ?? [],
      apiKeys: version.apiKeys ?? {},
      isActive: version.isActive ?? false,
      createdAt: version.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
    return id;
  },

  /** Set a version as active (deactivates all others for this project first) */
  activateVersion: async (
    userId: string,
    projectId: string,
    versionId: string
  ): Promise<void> => {
    // First deactivate all
    const q = query(versionsCol(userId), where('projectId', '==', projectId));
    const snap = await getDocs(q);
    const batch: Promise<void>[] = snap.docs.map(d =>
      setDoc(d.ref, { isActive: d.id === versionId, updatedAt: Date.now() }, { merge: true })
    );
    await Promise.all(batch);
  },

  /** Deactivate all versions (reset to Standard) */
  resetToStandard: async (userId: string, projectId: string): Promise<void> => {
    const q = query(versionsCol(userId), where('projectId', '==', projectId));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d =>
      setDoc(d.ref, { isActive: false, updatedAt: Date.now() }, { merge: true })
    ));
  },

  /** Update plugins for a version */
  updatePlugins: async (
    userId: string,
    versionId: string,
    plugins: Record<string, string>
  ): Promise<void> => {
    const ref = doc(versionsCol(userId), versionId);
    await setDoc(ref, { plugins, updatedAt: Date.now() }, { merge: true });
  },

  /** Delete a version */
  deleteVersion: async (userId: string, versionId: string): Promise<void> => {
    await deleteDoc(doc(versionsCol(userId), versionId));
  },
};
