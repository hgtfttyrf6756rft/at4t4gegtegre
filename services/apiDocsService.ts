import { db } from './firebase';
import {
  collection, getDocs, doc, setDoc, deleteDoc, query, where
} from 'firebase/firestore';
import { ApiDocEntry } from '../types';

const DOCS_COL = 'api_docs'; // global/public collection

export const apiDocsService = {

  /** Fetch all doc entries (admin use) */
  getAllDocs: async (): Promise<ApiDocEntry[]> => {
    try {
      const snap = await getDocs(collection(db, DOCS_COL));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as ApiDocEntry));
    } catch (e) {
      console.error('[apiDocsService] getAllDocs error:', e);
      return [];
    }
  },

  /**
   * Search docs by keywords — scores each doc by how many query words
   * appear in the api name, tags, or documentation text.
   * Returns top results (max 3) relevant to a user prompt.
   */
  searchRelevantDocs: async (userPrompt: string, maxResults = 3): Promise<ApiDocEntry[]> => {
    try {
      const all = await apiDocsService.getAllDocs();
      const words = userPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);

      const scored = all.map(doc => {
        const haystack = [
          doc.api.toLowerCase(),
          ...doc.tags.map(t => t.toLowerCase()),
          doc.documentation.toLowerCase().slice(0, 500), // only score on intro
        ].join(' ');

        const score = words.reduce((acc, word) => acc + (haystack.includes(word) ? 1 : 0), 0);
        return { doc, score };
      });

      return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(s => s.doc);
    } catch (e) {
      console.error('[apiDocsService] searchRelevantDocs error:', e);
      return [];
    }
  },

  /** Save or update a doc entry (admin only) */
  saveDoc: async (entry: Partial<ApiDocEntry> & { api: string; documentation: string }): Promise<string> => {
    const id = entry.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ref = doc(db, DOCS_COL, id);
    await setDoc(ref, {
      ...entry,
      id,
      tags: entry.tags ?? [],
      updatedAt: Date.now(),
    }, { merge: true });
    return id;
  },

  /** Delete a doc entry (admin only) */
  deleteDoc: async (id: string): Promise<void> => {
    await deleteDoc(doc(db, DOCS_COL, id));
  },
};
