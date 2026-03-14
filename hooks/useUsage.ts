import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import {
    getUserCredits,
    CREDIT_COSTS,
    CreditOperation,
    getCreditCost,
    getOperationDisplayName
} from '../services/creditService';

export interface UseCreditsReturn {
    /** Current credit balance */
    credits: number;
    /** Whether credits are being loaded */
    loading: boolean;
    /** Refresh credits from Firebase */
    refreshCredits: () => Promise<void>;
    /** Check if user can afford an operation */
    canAfford: (operation: CreditOperation) => boolean;
    /** Get the cost of an operation */
    getCost: (operation: CreditOperation) => number;
    /** Get display name for an operation */
    getDisplayName: (operation: CreditOperation) => string;
    /** Show insufficient credits modal state */
    showInsufficientModal: boolean;
    /** The operation that triggered the insufficient modal */
    insufficientOperation: CreditOperation | null;
    /** Credits needed for the blocked operation */
    creditsNeeded: number;
    /** Open insufficient credits modal */
    openInsufficientModal: (operation: CreditOperation) => void;
    /** Close insufficient credits modal */
    closeInsufficientModal: () => void;
}

export function useCredits(): UseCreditsReturn {
    const [credits, setCredits] = useState(0);
    const [loading, setLoading] = useState(true);
    const [showInsufficientModal, setShowInsufficientModal] = useState(false);
    const [insufficientOperation, setInsufficientOperation] = useState<CreditOperation | null>(null);
    const [creditsNeeded, setCreditsNeeded] = useState(0);

    const refreshCredits = useCallback(async () => {
        try {
            const currentCredits = await getUserCredits();
            setCredits(currentCredits);
        } catch (error) {
            console.error('Error refreshing credits:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Listen to auth state and fetch credits in real-time
    useEffect(() => {
        let unsubscribeSnapshot: (() => void) | undefined;

        const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            if (user) {
                // Subscribe to real-time updates for the user's credits
                try {
                    const userRef = doc(db, 'users', user.uid);
                    unsubscribeSnapshot = onSnapshot(userRef, (docSnap) => {
                        if (docSnap.exists()) {
                            const data = docSnap.data();
                            setCredits(data.credits ?? 0);
                        } else {
                            setCredits(0);
                        }
                        setLoading(false);
                    }, (error) => {
                        console.error("Error listening to credit changes:", error);
                        setLoading(false);
                    });
                } catch (error) {
                    console.error("Error setting up credit listener:", error);
                    setLoading(false);
                }
            } else {
                setCredits(0);
                setLoading(false);
                if (unsubscribeSnapshot) {
                    unsubscribeSnapshot();
                    unsubscribeSnapshot = undefined;
                }
            }
        });

        return () => {
            unsubscribeAuth();
            if (unsubscribeSnapshot) {
                unsubscribeSnapshot();
            }
        };
    }, []);

    // Check if user can afford an operation
    const canAfford = useCallback((operation: CreditOperation): boolean => {
        const cost = CREDIT_COSTS[operation];
        return credits >= cost;
    }, [credits]);

    // Get cost wrapper
    const getCost = useCallback((operation: CreditOperation): number => {
        return getCreditCost(operation);
    }, []);

    // Get display name wrapper
    const getDisplayName = useCallback((operation: CreditOperation): string => {
        return getOperationDisplayName(operation);
    }, []);

    // Open insufficient credits modal
    const openInsufficientModal = useCallback((operation: CreditOperation) => {
        setInsufficientOperation(operation);
        setCreditsNeeded(CREDIT_COSTS[operation]);
        setShowInsufficientModal(true);
    }, []);

    // Close insufficient credits modal
    const closeInsufficientModal = useCallback(() => {
        setShowInsufficientModal(false);
        setInsufficientOperation(null);
        setCreditsNeeded(0);
    }, []);

    return {
        credits,
        loading,
        refreshCredits,
        canAfford,
        getCost,
        getDisplayName,
        showInsufficientModal,
        insufficientOperation,
        creditsNeeded,
        openInsufficientModal,
        closeInsufficientModal,
    };
}

export { CREDIT_COSTS, type CreditOperation };
