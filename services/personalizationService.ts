import { db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export interface Personalization {
  componentName: string;
  sourceCode: string;
  isActive: boolean;
  updatedAt: any;
}

export const personalizationService = {
  /**
   * Fetches the personalized code for a specific user and component.
   */
  getPersonalization: async (userId: string, componentName: string): Promise<Personalization | null> => {
    try {
      const docRef = doc(db, 'users', userId, 'personalizations', componentName);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as Personalization;
      }
    } catch (error) {
      console.error('Error fetching personalization:', error);
    }
    return null;
  },

  /**
   * Saves or updates a personalized component code.
   */
  savePersonalization: async (userId: string, componentName: string, sourceCode: string): Promise<void> => {
    try {
      const docRef = doc(db, 'users', userId, 'personalizations', componentName);
      await setDoc(docRef, {
        componentName,
        sourceCode,
        isActive: true,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('Error saving personalization:', error);
      throw error;
    }
  },

  /**
   * Resets a component to the standard version.
   */
  resetToDefault: async (userId: string, componentName: string): Promise<void> => {
    try {
      const docRef = doc(db, 'users', userId, 'personalizations', componentName);
      await setDoc(docRef, { isActive: false }, { merge: true });
    } catch (error) {
      console.error('Error resetting personalization:', error);
    }
  }
};
