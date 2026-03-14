import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db, auth } from './firebase.js';

// ============================================================================
// POST LIMIT CONSTANTS
// ============================================================================

export const FREE_TIER_DAILY_POST_LIMIT = 3;

export interface PostLimitCheck {
    canPost: boolean;
    canSchedule: boolean;
    postsToday: number;
    limit: number;
    resetTime: string; // ISO string for when limit resets
}

// ============================================================================
// POST LIMIT FUNCTIONS
// ============================================================================

/**
 * Get today's date key for tracking (YYYY-MM-DD format)
 */
function getTodayKey(): string {
    const now = new Date();
    return now.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

/**
 * Get tomorrow's midnight ISO string for display
 */
function getTomorrowMidnight(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.toISOString();
}

/**
 * Check if the current user can post based on their subscription status
 * and daily post count.
 * 
 * @param isSubscribed - Whether the user has an active Pro subscription
 * @returns PostLimitCheck object with current status
 */
export async function checkPostLimit(isSubscribed: boolean): Promise<PostLimitCheck> {
    const user = auth.currentUser;

    // Default response for logged-out users
    if (!user) {
        return {
            canPost: false,
            canSchedule: false,
            postsToday: 0,
            limit: FREE_TIER_DAILY_POST_LIMIT,
            resetTime: getTomorrowMidnight(),
        };
    }

    // Pro users have unlimited posting and scheduling
    if (isSubscribed) {
        return {
            canPost: true,
            canSchedule: true,
            postsToday: 0,
            limit: Infinity,
            resetTime: getTomorrowMidnight(),
        };
    }

    // Free users: check daily limit
    try {
        const todayKey = getTodayKey();
        const metricsRef = doc(db, 'users', user.uid, 'postMetrics', todayKey);
        const metricsDoc = await getDoc(metricsRef);

        const postsToday = metricsDoc.exists() ? (metricsDoc.data().count || 0) : 0;
        const canPost = postsToday < FREE_TIER_DAILY_POST_LIMIT;

        return {
            canPost,
            canSchedule: false, // Free users cannot schedule
            postsToday,
            limit: FREE_TIER_DAILY_POST_LIMIT,
            resetTime: getTomorrowMidnight(),
        };
    } catch (error) {
        console.error('Error checking post limit:', error);
        // On error, deny to be safe
        return {
            canPost: false,
            canSchedule: false,
            postsToday: 0,
            limit: FREE_TIER_DAILY_POST_LIMIT,
            resetTime: getTomorrowMidnight(),
        };
    }
}

/**
 * Increment the post count for today.
 * Should be called after a successful post.
 * 
 * @returns true if successful, false otherwise
 */
export async function incrementPostCount(): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;

    try {
        const todayKey = getTodayKey();
        const metricsRef = doc(db, 'users', user.uid, 'postMetrics', todayKey);
        const metricsDoc = await getDoc(metricsRef);

        if (metricsDoc.exists()) {
            // Document exists, increment count
            await updateDoc(metricsRef, {
                count: increment(1),
                lastUpdated: new Date().toISOString(),
            });
        } else {
            // Create new document for today
            await setDoc(metricsRef, {
                count: 1,
                date: todayKey,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
            });
        }

        console.log(`Incremented post count for ${todayKey}`);
        return true;
    } catch (error) {
        console.error('Error incrementing post count:', error);
        return false;
    }
}

/**
 * Get the current post count for today (for display purposes)
 */
export async function getTodayPostCount(): Promise<number> {
    const user = auth.currentUser;
    if (!user) return 0;

    try {
        const todayKey = getTodayKey();
        const metricsRef = doc(db, 'users', user.uid, 'postMetrics', todayKey);
        const metricsDoc = await getDoc(metricsRef);

        return metricsDoc.exists() ? (metricsDoc.data().count || 0) : 0;
    } catch (error) {
        console.error('Error getting today post count:', error);
        return 0;
    }
}
