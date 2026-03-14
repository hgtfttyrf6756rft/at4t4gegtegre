import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db, auth } from './firebase.js';

export type UsageType = 'research' | 'podcast' | 'website' | 'image' | 'video' | 'social';

export interface UsageLimits {
  research: number;
  podcast: number;
  website: number;
  image: number;
  video: number;
  social: number;
}

export interface UsageData {
  research: number;
  podcast: number;
  website: number;
  image: number;
  video: number;
  social: number;
  lastResetDate: string;
  lastMonthlyResetDate: string;
}

const FREE_LIMITS: UsageLimits = {
  research: Number.MAX_SAFE_INTEGER,
  podcast: 4,
  website: 2,
  image: 0,
  video: 0,
  social: 0,
};

const PRO_LIMITS: UsageLimits = {
  research: 10,
  podcast: 40,
  website: 20,
  image: 100,
  video: 15,
  social: 20,
};

const DAILY_RESET_TYPES: UsageType[] = ['research', 'podcast', 'website'];
const MONTHLY_RESET_TYPES: UsageType[] = ['image', 'video', 'social'];

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function getMonthString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getDefaultUsageData(): UsageData {
  return {
    research: 0,
    podcast: 0,
    website: 0,
    image: 0,
    video: 0,
    social: 0,
    lastResetDate: getTodayString(),
    lastMonthlyResetDate: getMonthString(),
  };
}

export function getLimits(isSubscribed: boolean): UsageLimits {
  return isSubscribed ? PRO_LIMITS : FREE_LIMITS;
}

export function getLimitDisplayName(type: UsageType): string {
  const names: Record<UsageType, string> = {
    research: 'Deep Research',
    podcast: 'Podcast Generation',
    website: 'Website Creation',
    image: 'Image Generation',
    video: 'Video Generation',
    social: 'Social Media Assets',
  };
  return names[type];
}

export function getResetPeriod(type: UsageType): 'daily' | 'monthly' {
  return MONTHLY_RESET_TYPES.includes(type) ? 'monthly' : 'daily';
}

async function getUserUsageDoc() {
  const user = auth.currentUser;
  if (!user) return null;
  return doc(db, 'users', user.uid, 'usage', 'current');
}

export async function getUsageData(): Promise<UsageData | null> {
  const usageDoc = await getUserUsageDoc();
  if (!usageDoc) return null;

  try {
    const snapshot = await getDoc(usageDoc);
    if (!snapshot.exists()) {
      return getDefaultUsageData();
    }

    const data = snapshot.data() as UsageData;
    const today = getTodayString();
    const currentMonth = getMonthString();
    let needsUpdate = false;
    const updates: Partial<UsageData> = {};

    if (data.lastResetDate !== today) {
      for (const type of DAILY_RESET_TYPES) {
        updates[type] = 0;
      }
      updates.lastResetDate = today;
      needsUpdate = true;
    }

    if (data.lastMonthlyResetDate !== currentMonth) {
      for (const type of MONTHLY_RESET_TYPES) {
        updates[type] = 0;
      }
      updates.lastMonthlyResetDate = currentMonth;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await updateDoc(usageDoc, updates);
      return { ...data, ...updates };
    }

    return data;
  } catch (error) {
    console.error('Error fetching usage data:', error);
    return getDefaultUsageData();
  }
}

export async function checkUsageLimit(type: UsageType, isSubscribed: boolean): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
}> {
  const limits = getLimits(isSubscribed);
  const limit = limits[type];
  
  // Subscribed users have their in-app limits effectively lifted.
  // We still track usage for analytics, but we never block actions.
  if (isSubscribed) {
    const usageData = await getUsageData();
    const current = usageData?.[type] ?? 0;

    return {
      allowed: true,
      current,
      limit,
      // Use a large remaining value instead of Infinity to keep types simple.
      remaining: Number.MAX_SAFE_INTEGER,
    };
  }
  
  if (type === 'research' && !isSubscribed) {
    const usageData = await getUsageData();
    const current = usageData?.[type] ?? 0;

    return {
      allowed: true,
      current,
      limit: Number.MAX_SAFE_INTEGER,
      remaining: Number.MAX_SAFE_INTEGER,
    };
  }

  if (limit === 0 && !isSubscribed) {
    return { allowed: false, current: 0, limit: 0, remaining: 0 };
  }

  const usageData = await getUsageData();
  const current = usageData?.[type] ?? 0;
  const remaining = Math.max(0, limit - current);

  // Ensure usage doc exists for first-time users
  if (!usageData) {
    const usageDoc = await getUserUsageDoc();
    if (usageDoc) {
      try {
        await setDoc(usageDoc, getDefaultUsageData());
      } catch (e) {
        console.error('Error initializing usage doc:', e);
      }
    }
  }

  return {
    allowed: current < limit,
    current,
    limit,
    remaining,
  };
}

export async function incrementUsage(type: UsageType): Promise<boolean> {
  const usageDoc = await getUserUsageDoc();
  if (!usageDoc) return false;

  try {
    const snapshot = await getDoc(usageDoc);
    
    if (!snapshot.exists()) {
      const defaultData = getDefaultUsageData();
      defaultData[type] = 1;
      await setDoc(usageDoc, defaultData);
    } else {
      await updateDoc(usageDoc, {
        [type]: increment(1),
      });
    }
    return true;
  } catch (error) {
    console.error('Error incrementing usage:', error);
    return false;
  }
}

export async function getRemainingUsage(isSubscribed: boolean): Promise<Record<UsageType, number>> {
  const limits = getLimits(isSubscribed);
  const usageData = await getUsageData();

  const remaining: Record<UsageType, number> = {
    research: 0,
    podcast: 0,
    website: 0,
    image: 0,
    video: 0,
    social: 0,
  };

  for (const type of Object.keys(limits) as UsageType[]) {
    const current = usageData?.[type] ?? 0;
    remaining[type] = Math.max(0, limits[type] - current);
  }

  return remaining;
}
