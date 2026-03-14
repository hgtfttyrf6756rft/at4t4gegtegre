import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db, auth } from './firebase.js';

// ============================================================================
// CREDIT CONSTANTS
// ============================================================================

export const DEFAULT_CREDITS = 125;
export const PRO_SUBSCRIPTION_CREDITS = 2500;

/**
 * Credit costs for all AI features.
 * These values determine how many credits are deducted per operation.
 */
export const CREDIT_COSTS = {
    // Minimal (1 credit) - High frequency, low cost
    inlineAiAsk: 1,

    // Low cost (2 credits)
    aiTableEdit: 2,
    aiDocEdit: 2,
    quickNoteGeneration: 2,
    noteEnhancement: 2,

    // Low-Medium (5 credits)
    seoSearch: 5,
    socialPostGeneration: 5,

    // Medium (10-15 credits)
    blogGeneration: 10,
    websiteEdit: 10,
    tableGeneration: 15,
    docGeneration: 15,

    // Standard (20-25 credits)
    podcastGeneration: 20,
    videoSequenceGeneration: 20,
    imageGenerationFast: 20,
    imageGenerationPro: 25,
    podcastShort: 25,

    // Higher (30-35 credits)
    podcastMedium: 30,
    videoClipGeneration: 35,

    // Premium (40-45 credits)
    podcastLong: 40,
    bookGeneration: 40,
    formGeneration: 45,
    researchSession: 45,

    // High (50-60 credits)
    websiteGeneration: 50,
    magicProjectGeneration: 50,
    deepResearch: 60,

    // Highest (70+ credits)
    videoOverviewGeneration: 100, // Cost is per slide (multiplier)

    // Other missing operations
    chartGeneration: 10,
    appMockupGeneration: 40,
    appSubmission: 100,

    // New Operations
    productAdGeneration: 35,
    animateImageGeneration: 35,
    realVsAiGeneration: 60,
    musicVideoGeneration: 250,
    videoEdition: 35,
    worldGeneration: 50,
    videoLive: 35,
    videoEditXai: 35,
    audioGeneration: 5,
    phoneProvisioning: 400,
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;

export interface CreditBalance {
    credits: number;
    creditsLastUpdated: string;
}

// ============================================================================
// UNLIMITED PLAN FEATURES
// ============================================================================

/**
 * Operations that are FREE for unlimited subscribers even after credits run out.
 * These are the premium features that define the Unlimited tier:
 * - Deep Research
 * - Image & Video Generation
 * - Browser Automation (included in research)
 * - Podcasts
 * - Social Media Scheduling (no credit cost anyway)
 * - Email Campaigns
 */
export const UNLIMITED_BYPASS_OPERATIONS: Set<CreditOperation> = new Set([
    // Deep Research
    'deepResearch',
    'researchSession',

    // Image Generation
    'imageGenerationFast',
    'imageGenerationPro',

    // Video Generation
    'videoSequenceGeneration',
    'videoClipGeneration',
    'videoOverviewGeneration',

    // New Video Studio Ops
    'productAdGeneration',
    'animateImageGeneration',
    'realVsAiGeneration',
    'musicVideoGeneration',

    // Podcasts
    'podcastGeneration',
    'podcastShort',
    'podcastMedium',
    'podcastLong',
    'audioGeneration',

    // Social/Email (these support campaigns)
    'socialPostGeneration',
]);

/**
 * Check if the current user has an unlimited subscription.
 * Returns true if the user has unlimited=true in their Firestore document.
 */
export async function isUnlimitedUser(): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;

    try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            return data.unlimited === true;
        }

        return false;
    } catch (error) {
        console.error('Error checking unlimited status:', error);
        return false;
    }
}

// ============================================================================
// CREDIT FUNCTIONS
// ============================================================================

/**
 * Get the current user's credit balance.
 * Returns 0 if user is not logged in or has no credits field.
 */
export async function getUserCredits(): Promise<number> {
    const user = auth.currentUser;
    if (!user) return 0;

    try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            return data.credits ?? 0;
        }

        return 0;
    } catch (error) {
        console.error('Error fetching user credits:', error);
        return 0;
    }
}

/**
 * Check if the current user has enough credits for a specific operation.
 * Unlimited subscribers automatically pass for UNLIMITED_BYPASS_OPERATIONS.
 */
export async function hasEnoughCredits(operation: CreditOperation, costMultiplier: number = 1): Promise<boolean> {
    // Check if this operation is covered by unlimited plan
    if (UNLIMITED_BYPASS_OPERATIONS.has(operation)) {
        const unlimited = await isUnlimitedUser();
        if (unlimited) {
            console.log(`Unlimited user bypass for operation: ${operation}`);
            return true;
        }
    }

    const credits = await getUserCredits();
    const baseCost = CREDIT_COSTS[operation];
    const totalCost = baseCost * costMultiplier;
    return credits >= totalCost;
}

/**
 * Get the cost of a specific operation.
 */
export function getCreditCost(operation: CreditOperation): number {
    return CREDIT_COSTS[operation];
}

/**
 * Deduct credits for a specific operation.
 * Returns true if successful, false if insufficient credits or error.
 * 
 * IMPORTANT: This should be called BEFORE performing the AI operation.
 * Unlimited subscribers skip deduction for UNLIMITED_BYPASS_OPERATIONS.
 */
export async function deductCredits(operation: CreditOperation, costMultiplier: number = 1): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;

    // Check if this operation is covered by unlimited plan - if so, skip deduction
    if (UNLIMITED_BYPASS_OPERATIONS.has(operation)) {
        const unlimited = await isUnlimitedUser();
        if (unlimited) {
            console.log(`Unlimited user - skipping credit deduction for: ${operation}`);
            return true;
        }
    }

    const baseCost = CREDIT_COSTS[operation];
    const totalCost = baseCost * costMultiplier;

    try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            console.error('User document does not exist');
            return false;
        }

        const currentCredits = userDoc.data().credits ?? 0;

        if (currentCredits < totalCost) {
            console.warn(`Insufficient credits: have ${currentCredits}, need ${totalCost}`);
            return false;
        }

        // Atomically decrement credits
        await updateDoc(userRef, {
            credits: increment(-totalCost),
            creditsLastUpdated: new Date().toISOString(),
        });

        console.log(`Deducted ${totalCost} credits for ${operation}. Remaining: ${currentCredits - totalCost}`);
        return true;
    } catch (error) {
        console.error('Error deducting credits:', error);
        return false;
    }
}

/**
 * Add credits to the current user's account.
 * Used primarily by the Stripe webhook on subscription.
 */
export async function addCredits(amount: number): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;

    try {
        const userRef = doc(db, 'users', user.uid);

        await updateDoc(userRef, {
            credits: increment(amount),
            creditsLastUpdated: new Date().toISOString(),
        });

        console.log(`Added ${amount} credits to user ${user.uid}`);
        return true;
    } catch (error) {
        console.error('Error adding credits:', error);
        return false;
    }
}

/**
 * Initialize credits for a new user.
 * This is called when a user document is first created.
 * 
 * @param userId - The Firebase user ID
 * @param amount - Initial credit amount (defaults to DEFAULT_CREDITS = 125)
 */
export async function initializeUserCredits(
    userId: string,
    amount: number = DEFAULT_CREDITS
): Promise<boolean> {
    try {
        const userRef = doc(db, 'users', userId);

        await setDoc(userRef, {
            credits: amount,
            creditsLastUpdated: new Date().toISOString(),
        }, { merge: true });

        console.log(`Initialized ${amount} credits for user ${userId}`);
        return true;
    } catch (error) {
        console.error('Error initializing user credits:', error);
        return false;
    }
}

/**
 * Get a human-readable name for a credit operation.
 */
export function getOperationDisplayName(operation: CreditOperation): string {
    const names: Record<CreditOperation, string> = {
        inlineAiAsk: 'Inline AI Ask',
        aiTableEdit: 'AI Table Edit',
        aiDocEdit: 'AI Document Edit',
        quickNoteGeneration: 'Quick Note Generation',
        noteEnhancement: 'Note Enhancement',
        seoSearch: 'SEO Search',
        socialPostGeneration: 'Social Post Generation',
        blogGeneration: 'Blog Generation',
        websiteEdit: 'AI Website Edit',
        tableGeneration: 'Table Generation',
        docGeneration: 'Document Generation',
        podcastGeneration: 'Podcast Generation',
        videoSequenceGeneration: 'Video Sequence',
        imageGenerationFast: 'Image Generation (Fast)',
        imageGenerationPro: 'Image Generation (Pro)',
        podcastShort: 'Short Podcast',
        podcastMedium: 'Medium Podcast',
        podcastLong: 'Long Podcast',
        videoClipGeneration: 'Video Clip',
        bookGeneration: 'Book Generation',
        formGeneration: 'Form Generation',
        researchSession: 'Research Session',
        websiteGeneration: 'Website Generation',
        magicProjectGeneration: 'Magic Project',
        deepResearch: 'Deep Research',
        videoOverviewGeneration: 'Video Overview',
        chartGeneration: 'Chart Generation',
        appMockupGeneration: 'App Mockup',
        appSubmission: 'App Submission',
        productAdGeneration: 'Product Ad',
        animateImageGeneration: 'Animate Image',
        realVsAiGeneration: 'Real vs AI',
        musicVideoGeneration: 'Music Video',
        videoEdition: 'Video Editing',
        worldGeneration: 'World Generation',
        videoLive: 'Live Video Session',
        videoEditXai: 'Video Editing (xAI)',
        audioGeneration: 'Audio Generation',
        phoneProvisioning: 'Phone Number Provisioning',
    };
    return names[operation] || operation;
}

/**
 * Check credits and show a modal if insufficient.
 * Returns true if the user has enough credits, false otherwise.
 * 
 * @param operation - The operation to check
 * @param showInsufficientModal - Callback to show the "not enough credits" modal
 * @param costMultiplier - Multiplier for dynamic credit costs (defaults to 1)
 */
export async function checkCreditsWithModal(
    operation: CreditOperation,
    showInsufficientModal: (operation: CreditOperation, needed: number, current: number) => void,
    costMultiplier: number = 1
): Promise<boolean> {
    const credits = await getUserCredits();
    const baseCost = CREDIT_COSTS[operation];
    const totalCost = baseCost * costMultiplier;

    if (credits < totalCost) {
        showInsufficientModal(operation, totalCost, credits);
        return false;
    }

    return true;
}
