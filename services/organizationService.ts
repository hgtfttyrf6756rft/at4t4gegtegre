import {
    collection,
    query,
    where,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    arrayUnion,
    getDoc,
    serverTimestamp,
    Transaction,
    runTransaction
} from 'firebase/firestore';
import { db } from './firebase.js';
import { UserProfile } from '../types.js';
import { isWorkEmail, getEmailDomain } from './emailValidation.js';

export interface Organization {
    id: string;
    name: string;
    domain: string;
    members: string[]; // List of User UIDs
    createdAt: any;
}

const ORG_COLLECTION = 'organizations';
const USERS_COLLECTION = 'users';

/**
 * Attempts to add a user to an organization based on their email domain.
 * If user has a work email, checks if an org exists for that domain.
 * If yes, joins it. If no, creates it.
 * Updates the user's profile in Firestore with the new organizationId.
 * 
 * @returns The organizationId if joined/created, or null if personal email/invalid.
 */
export const createOrJoinOrganization = async (
    userId: string,
    userProfile: UserProfile
): Promise<string | null> => {
    if (!userProfile.email || !userId) return null;

    // 1. Validate if it's a work email
    if (!isWorkEmail(userProfile.email)) {
        console.log('Detected personal email, skipping organization creation.');
        return null;
    }

    const domain = getEmailDomain(userProfile.email);
    if (!domain) return null;

    try {
        const orgId = await runTransaction(db, async (transaction) => {
            // 2. Check if organization exists for this domain
            const orgQ = query(collection(db, ORG_COLLECTION), where('domain', '==', domain));
            const orgSnapshot = await getDocs(orgQ);

            let targetOrgId: string;

            if (!orgSnapshot.empty) {
                // Organization exists, join it
                const orgDoc = orgSnapshot.docs[0];
                targetOrgId = orgDoc.id;

                // Add user to members list if not already there
                transaction.update(doc(db, ORG_COLLECTION, targetOrgId), {
                    members: arrayUnion(userId)
                });
            } else {
                // Create new organization
                const newOrgRef = doc(collection(db, ORG_COLLECTION));
                targetOrgId = newOrgRef.id;

                transaction.set(newOrgRef, {
                    name: domain.charAt(0).toUpperCase() + domain.slice(1), // Simple capitalization
                    domain: domain,
                    members: [userId],
                    createdAt: serverTimestamp()
                });
            }

            // 3. Update User Profile
            transaction.update(doc(db, USERS_COLLECTION, userId), {
                organizationId: targetOrgId
            });

            return targetOrgId;
        });

        console.log(`User ${userId} joined organization ${orgId} (${domain})`);
        return orgId;

    } catch (error) {
        console.error('Error creating/joining organization:', error);
        return null;
    }
};

/**
 * Fetches the profiles of all members in an organization.
 */
export const getOrganizationMembers = async (orgId: string): Promise<UserProfile[]> => {
    if (!orgId) return [];

    try {
        const orgDocRef = doc(db, ORG_COLLECTION, orgId);
        const orgDoc = await getDoc(orgDocRef);

        if (!orgDoc.exists()) {
            return [];
        }

        const data = orgDoc.data() as Organization;
        const memberIds = data.members || [];

        if (memberIds.length === 0) return [];

        // Firestore 'in' query supports up to 10 items.
        // If an org has >10 members, we need to batch or fetch individually.
        // For MVP, if <30 members, we can fetch individually in parallel. 
        // If scaling needed, we'd query the users collection where organizationId == orgId.

        // Better Approach: Query users by organizationId
        const usersQ = query(collection(db, USERS_COLLECTION), where('organizationId', '==', orgId));
        const usersSnapshot = await getDocs(usersQ);

        const members: UserProfile[] = [];
        usersSnapshot.forEach(doc => {
            members.push({ uid: doc.id, ...doc.data() } as any);
        });

        return members;

    } catch (error) {
        console.error('Error fetching organization members:', error);
        return [];
    }
};

/**
 * Gets organization details by ID
 */
export const getOrganization = async (orgId: string): Promise<Organization | null> => {
    try {
        const orgDoc = await getDoc(doc(db, ORG_COLLECTION, orgId));
        if (orgDoc.exists()) {
            return { id: orgDoc.id, ...orgDoc.data() } as Organization;
        }
        return null;
    } catch (error) {
        console.error("Error getting org:", error);
        return null;
    }
}
