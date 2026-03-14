import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import { subscriptionService, SubscriptionStatus } from '../services/subscriptionService';

export const useSubscription = () => {
  const [subscription, setSubscription] = useState<SubscriptionStatus>({ subscribed: false });
  const [loading, setLoading] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeModalTrigger, setUpgradeModalTrigger] = useState<'button' | 'error'>('button');
  const [initialTier, setInitialTier] = useState<'pro' | 'unlimited'>('pro');

  const fetchSubscription = useCallback(async () => {
    try {
      const status = await subscriptionService.getSubscriptionStatus();
      setSubscription(status);
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        fetchSubscription();
      } else {
        setSubscription({ subscribed: false });
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [fetchSubscription]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const subscriptionStatus = urlParams.get('subscription');

    if (subscriptionStatus === 'success') {
      fetchSubscription();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchSubscription]);

  const openUpgradeModal = useCallback((trigger: 'button' | 'error' = 'button', tier: 'pro' | 'unlimited' = 'pro') => {
    setUpgradeModalTrigger(trigger);
    setInitialTier(tier);
    setShowUpgradeModal(true);
  }, []);

  const closeUpgradeModal = useCallback(() => {
    setShowUpgradeModal(false);
  }, []);

  const handleRateLimitError = useCallback((error: any) => {
    if (subscriptionService.isRateLimitError(error) && !subscription.subscribed) {
      openUpgradeModal('error');
      return true;
    }
    return false;
  }, [subscription.subscribed, openUpgradeModal]);

  return {
    isSubscribed: subscription.subscribed,
    subscription,
    loading,
    showUpgradeModal,
    upgradeModalTrigger,
    initialTier,
    openUpgradeModal,
    closeUpgradeModal,
    handleRateLimitError,
    refreshSubscription: fetchSubscription,
  };
};
