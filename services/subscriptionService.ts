import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from './firebase.js';
import { authFetch } from './authFetch.js';

export interface SubscriptionStatus {
  subscribed: boolean;
  unlimited?: boolean;
  subscriptionTier?: 'pro' | 'unlimited';
  subscriptionId?: string;
  stripeCustomerId?: string;
  subscriptionUpdatedAt?: string;
}

export const subscriptionService = {
  async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    const user = auth.currentUser;
    if (!user) {
      return { subscribed: false };
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const data = userDoc.data();
        return {
          subscribed: data.subscribed || false,
          unlimited: data.unlimited || false,
          subscriptionTier: data.subscriptionTier || 'pro',
          subscriptionId: data.subscriptionId,
          stripeCustomerId: data.stripeCustomerId,
          subscriptionUpdatedAt: data.subscriptionUpdatedAt,
        };
      }

      return { subscribed: false };
    } catch (error) {
      console.error('Error fetching subscription status:', error);
      return { subscribed: false };
    }
  },

  async updateLocalSubscriptionStatus(subscribed: boolean): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        subscribed,
        subscriptionUpdatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error updating local subscription status:', error);
    }
  },

  async createCheckoutSession(priceType: 'monthly' | 'annual' | 'unlimited_monthly' | 'unlimited_annual'): Promise<string | null> {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user logged in');
      return null;
    }

    try {
      const response = await authFetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceType,
          userId: user.uid,
          userEmail: user.email,
          successUrl: `${window.location.origin}/?subscription=success`,
          cancelUrl: `${window.location.origin}/?subscription=cancelled`,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const data = await response.json();
      return data.url;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      return null;
    }
  },

  isRateLimitError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    const errorString = String(error).toLowerCase();

    return (
      error.status === 429 ||
      errorMessage.includes('429') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('quota exceeded') ||
      errorMessage.includes('resource exhausted') ||
      errorString.includes('429') ||
      errorString.includes('rate limit')
    );
  },
};
