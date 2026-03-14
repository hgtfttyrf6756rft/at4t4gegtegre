import { db, auth } from './firebase';
import {
    collection,
    doc,
    setDoc,
    updateDoc,
    onSnapshot,
    query,
    orderBy,
    getDocs,
    getDoc,
    where,
    addDoc,
    deleteDoc,
    serverTimestamp
} from 'firebase/firestore';
import { AgentAssignment, AgentLog, SwarmSession, TaskPlanStep } from '../types';

const SESSIONS_COLLECTION = 'agent_swarm_sessions';
const ASSIGNMENTS_COLLECTION = 'agent_assignments';
const LOGS_COLLECTION = 'agent_logs';

// ─── Swarm Sessions ─────────────────────────────────────────────────

export const createSwarmSession = async (
    adminId: string,
    directive: string
): Promise<string> => {
    const docRef = await addDoc(collection(db, SESSIONS_COLLECTION), {
        adminId,
        directive,
        status: 'active',
        liveSessionHandle: null,
        sharedContext: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
    return docRef.id;
};

export const updateSwarmSession = async (
    sessionId: string,
    updates: Partial<Pick<SwarmSession, 'status' | 'liveSessionHandle' | 'sharedContext'>>
) => {
    const docRef = doc(db, SESSIONS_COLLECTION, sessionId);
    await updateDoc(docRef, {
        ...updates,
        updatedAt: Date.now(),
    });
};

export const getSwarmSession = async (sessionId: string): Promise<SwarmSession | null> => {
    const docRef = doc(db, SESSIONS_COLLECTION, sessionId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as SwarmSession;
};

export const subscribeToSwarmSession = (
    sessionId: string,
    onUpdate: (session: SwarmSession | null) => void
) => {
    const docRef = doc(db, SESSIONS_COLLECTION, sessionId);
    return onSnapshot(docRef, (snap) => {
        if (!snap.exists()) {
            onUpdate(null);
            return;
        }
        onUpdate({ id: snap.id, ...snap.data() } as SwarmSession);
    });
};

export const subscribeToAllSessions = (onUpdate: (sessions: SwarmSession[]) => void) => {
    const q = query(
        collection(db, SESSIONS_COLLECTION),
        orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
        const sessions: SwarmSession[] = [];
        snapshot.forEach((doc) => {
            sessions.push({ id: doc.id, ...doc.data() } as SwarmSession);
        });
        onUpdate(sessions);
    });
};

// ─── Agent Assignments ───────────────────────────────────────────────

export const subscribeToActiveAssignments = (onUpdate: (assignments: AgentAssignment[]) => void) => {
    const q = query(
        collection(db, ASSIGNMENTS_COLLECTION),
        orderBy('createdAt', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
        const assignments: AgentAssignment[] = [];
        snapshot.forEach((doc) => {
            assignments.push({ id: doc.id, ...doc.data() } as AgentAssignment);
        });
        onUpdate(assignments);
    });
};

export const subscribeToSessionAssignments = (
    sessionId: string,
    onUpdate: (assignments: AgentAssignment[]) => void
) => {
    const q = query(
        collection(db, ASSIGNMENTS_COLLECTION),
        where('sessionId', '==', sessionId),
        orderBy('createdAt', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
        const assignments: AgentAssignment[] = [];
        snapshot.forEach((doc) => {
            assignments.push({ id: doc.id, ...doc.data() } as AgentAssignment);
        });
        onUpdate(assignments);
    });
};

export const subscribeToAssignmentLogs = (assignmentId: string, onUpdate: (logs: AgentLog[]) => void) => {
    const q = query(
        collection(db, LOGS_COLLECTION),
        where('assignmentId', '==', assignmentId),
        orderBy('timestamp', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
        const logs: AgentLog[] = [];
        snapshot.forEach((doc) => {
            logs.push({ id: doc.id, ...doc.data() } as AgentLog);
        });
        onUpdate(logs);
    });
};

export const createAgentAssignment = async (
    sessionId: string,
    adminId: string,
    targetUserId: string,
    targetProjectId: string,
    goal: string
): Promise<string> => {
    const docRef = await addDoc(collection(db, ASSIGNMENTS_COLLECTION), {
        sessionId,
        adminId,
        targetUserId,
        targetProjectId,
        goal,
        status: 'pending',
        taskPlan: [],
        currentStep: 0,
        contextSummary: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        retryCount: 0,
        maxRetries: 3,
    });
    return docRef.id;
};

export const updateAgentStatus = async (
    assignmentId: string,
    status: AgentAssignment['status'],
    error?: string
) => {
    const docRef = doc(db, ASSIGNMENTS_COLLECTION, assignmentId);
    const data: any = {
        status,
        updatedAt: Date.now()
    };

    if (status === 'running') {
        data.lastHeartbeatAt = Date.now();
    }

    if (error) {
        data.error = error;
    }

    await updateDoc(docRef, data);
};

export const updateAssignmentTaskPlan = async (
    assignmentId: string,
    taskPlan: TaskPlanStep[],
    currentStep?: number
) => {
    const docRef = doc(db, ASSIGNMENTS_COLLECTION, assignmentId);
    const data: any = {
        taskPlan,
        updatedAt: Date.now(),
    };
    if (currentStep !== undefined) {
        data.currentStep = currentStep;
    }
    await updateDoc(docRef, data);
};

export const updateAssignmentContext = async (
    assignmentId: string,
    contextSummary: string
) => {
    const docRef = doc(db, ASSIGNMENTS_COLLECTION, assignmentId);
    await updateDoc(docRef, {
        contextSummary,
        updatedAt: Date.now(),
    });
};

export const getAssignment = async (assignmentId: string): Promise<AgentAssignment | null> => {
    const docRef = doc(db, ASSIGNMENTS_COLLECTION, assignmentId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as AgentAssignment;
};

export const getSessionAssignments = async (sessionId: string): Promise<AgentAssignment[]> => {
    const q = query(
        collection(db, ASSIGNMENTS_COLLECTION),
        where('sessionId', '==', sessionId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AgentAssignment));
};

export const cancelAgentAssignment = async (assignmentId: string) => {
    const docRef = doc(db, ASSIGNMENTS_COLLECTION, assignmentId);
    await updateDoc(docRef, {
        status: 'failed',
        error: 'Cancelled by admin',
        updatedAt: Date.now(),
    });
};

// ─── Agent Logs ──────────────────────────────────────────────────────

export const appendAgentLog = async (
    assignmentId: string,
    step: string,
    message: string,
    status: AgentLog['status'] = 'info',
    artifactsCreated?: AgentLog['artifactsCreated']
) => {
    await addDoc(collection(db, LOGS_COLLECTION), {
        assignmentId,
        step,
        message,
        status,
        timestamp: Date.now(),
        artifactsCreated: artifactsCreated || []
    });
};

export const getAssignmentLogs = async (assignmentId: string): Promise<AgentLog[]> => {
    const q = query(
        collection(db, LOGS_COLLECTION),
        where('assignmentId', '==', assignmentId),
        orderBy('timestamp', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AgentLog));
};

// ─── Shared Context (Inter-Agent Awareness) ──────────────────────────

export const updateSharedContext = async (sessionId: string, newContext: string) => {
    const docRef = doc(db, SESSIONS_COLLECTION, sessionId);
    await updateDoc(docRef, {
        sharedContext: newContext,
        updatedAt: Date.now(),
    });
};

export const pingSwarmWorker = async () => {
    try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        fetch('/api/agent-swarm-worker', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
        }).catch(e => console.error('Swarm ping failed', e));
    } catch (e) {
        console.error('Swarm ping auth failed', e);
    }
};
