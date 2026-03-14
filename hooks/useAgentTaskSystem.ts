import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Agent Task System - Simple task tracking for AI agents.
 * 
 * Features:
 * - Task queue with priority support
 * - localStorage persistence
 * - Basic task lifecycle management (no stall detection/nudging)
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface AgentTask {
    id: string;
    type: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    metadata?: Record<string, any>;
    error?: string;
}

export interface TaskSystemConfig {
    /** Storage key prefix for localStorage persistence */
    storageKeyPrefix?: string;
}

export interface TaskSystemState {
    tasks: AgentTask[];
    currentTask: AgentTask | null;
    isProcessing: boolean;
}

export interface TaskSystemActions {
    /** Add a new task to the queue */
    addTask: (type: string, description: string, options?: {
        priority?: TaskPriority;
        metadata?: Record<string, any>;
    }) => AgentTask;
    /** Start processing the next pending task */
    startNextTask: () => AgentTask | null;
    /** Mark a specific task as in progress */
    startTask: (taskId: string) => void;
    /** Mark a task as completed */
    completeTask: (taskId?: string) => void;
    /** Mark a task as failed */
    failTask: (taskId: string, error?: string) => void;
    /** Cancel a task */
    cancelTask: (taskId: string) => void;
    /** Clear all completed/failed tasks */
    clearFinishedTasks: () => void;
    /** Clear all tasks */
    clearAllTasks: () => void;
    /** Get a task by ID */
    getTask: (taskId: string) => AgentTask | undefined;
    /** Update task metadata */
    updateTaskMetadata: (taskId: string, metadata: Record<string, any>) => void;
}

export type UseAgentTaskSystem = TaskSystemState & TaskSystemActions;

const DEFAULT_CONFIG: Required<TaskSystemConfig> = {
    storageKeyPrefix: 'agent_task_system',
};

const generateTaskId = (): string => {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

const sortByPriority = (a: AgentTask, b: AgentTask): number => {
    const priorityOrder: Record<TaskPriority, number> = {
        urgent: 0,
        high: 1,
        normal: 2,
        low: 3,
    };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
};

export function useAgentTaskSystem(
    projectId: string,
    config: TaskSystemConfig = {}
): UseAgentTaskSystem {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const storageKey = `${mergedConfig.storageKeyPrefix}_${projectId}`;

    // State
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [currentTask, setCurrentTask] = useState<AgentTask | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    // Refs for callback access
    const tasksRef = useRef<AgentTask[]>([]);
    const currentTaskRef = useRef<AgentTask | null>(null);

    // Keep refs in sync
    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    useEffect(() => {
        currentTaskRef.current = currentTask;
    }, [currentTask]);

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed.tasks)) {
                    // Filter out completed/failed tasks older than 1 hour
                    const oneHourAgo = Date.now() - 3600000;
                    const activeTasks = parsed.tasks.filter((t: AgentTask) =>
                        t.status === 'pending' || t.status === 'in_progress' ||
                        (t.completedAt && t.completedAt > oneHourAgo)
                    );
                    setTasks(activeTasks);

                    // Restore current task if it was in progress
                    const inProgress = activeTasks.find((t: AgentTask) => t.status === 'in_progress');
                    if (inProgress) {
                        setCurrentTask(inProgress);
                        setIsProcessing(true);
                    }
                }
            }
        } catch (e) {
            console.warn('[TaskSystem] Failed to load from localStorage:', e);
        }
    }, [storageKey]);

    // Save to localStorage when tasks change
    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify({ tasks, lastUpdated: Date.now() }));
        } catch (e) {
            console.warn('[TaskSystem] Failed to save to localStorage:', e);
        }
    }, [tasks, storageKey]);

    // Actions
    const addTask = useCallback((
        type: string,
        description: string,
        options?: {
            priority?: TaskPriority;
            metadata?: Record<string, any>;
        }
    ): AgentTask => {
        const newTask: AgentTask = {
            id: generateTaskId(),
            type,
            description,
            status: 'pending',
            priority: options?.priority || 'normal',
            createdAt: Date.now(),
            metadata: options?.metadata,
        };

        console.log('[TaskSystem] Adding task:', newTask.description);
        setTasks(prev => [...prev, newTask].sort(sortByPriority));
        return newTask;
    }, []);

    const startNextTask = useCallback((): AgentTask | null => {
        const pending = tasksRef.current
            .filter(t => t.status === 'pending')
            .sort(sortByPriority);

        if (pending.length === 0) return null;

        const next = pending[0];
        const updatedTask: AgentTask = {
            ...next,
            status: 'in_progress',
            startedAt: Date.now(),
        };

        console.log('[TaskSystem] Starting task:', updatedTask.description);
        setTasks(prev => prev.map(t => t.id === next.id ? updatedTask : t));
        setCurrentTask(updatedTask);
        setIsProcessing(true);

        return updatedTask;
    }, []);

    const startTask = useCallback((taskId: string): void => {
        setTasks(prev => {
            const task = prev.find(t => t.id === taskId);
            if (!task || task.status !== 'pending') return prev;

            const updatedTask: AgentTask = {
                ...task,
                status: 'in_progress',
                startedAt: Date.now(),
            };

            console.log('[TaskSystem] Starting specific task:', updatedTask.description);
            setCurrentTask(updatedTask);
            setIsProcessing(true);

            return prev.map(t => t.id === taskId ? updatedTask : t);
        });
    }, []);

    const completeTask = useCallback((taskId?: string): void => {
        const idToComplete = taskId || currentTaskRef.current?.id;
        if (!idToComplete) return;

        console.log('[TaskSystem] Completing task:', idToComplete);

        setTasks(prev => prev.map(t =>
            t.id === idToComplete
                ? { ...t, status: 'completed' as TaskStatus, completedAt: Date.now() }
                : t
        ));

        if (currentTaskRef.current?.id === idToComplete) {
            setCurrentTask(null);
            setIsProcessing(false);
        }
    }, []);

    const failTask = useCallback((taskId: string, error?: string): void => {
        console.log('[TaskSystem] Failing task:', taskId, error);

        setTasks(prev => prev.map(t =>
            t.id === taskId
                ? { ...t, status: 'failed' as TaskStatus, error, completedAt: Date.now() }
                : t
        ));

        if (currentTaskRef.current?.id === taskId) {
            setCurrentTask(null);
            setIsProcessing(false);
        }
    }, []);

    const cancelTask = useCallback((taskId: string): void => {
        console.log('[TaskSystem] Cancelling task:', taskId);

        setTasks(prev => prev.map(t =>
            t.id === taskId
                ? { ...t, status: 'cancelled' as TaskStatus, completedAt: Date.now() }
                : t
        ));

        if (currentTaskRef.current?.id === taskId) {
            setCurrentTask(null);
            setIsProcessing(false);
        }
    }, []);

    const clearFinishedTasks = useCallback((): void => {
        setTasks(prev => prev.filter(t =>
            t.status === 'pending' || t.status === 'in_progress'
        ));
    }, []);

    const clearAllTasks = useCallback((): void => {
        setTasks([]);
        setCurrentTask(null);
        setIsProcessing(false);
    }, []);

    const getTask = useCallback((taskId: string): AgentTask | undefined => {
        return tasksRef.current.find(t => t.id === taskId);
    }, []);

    const updateTaskMetadata = useCallback((taskId: string, metadata: Record<string, any>): void => {
        setTasks(prev => prev.map(t =>
            t.id === taskId
                ? { ...t, metadata: { ...t.metadata, ...metadata } }
                : t
        ));
    }, []);

    return {
        // State
        tasks,
        currentTask,
        isProcessing,
        // Actions
        addTask,
        startNextTask,
        startTask,
        completeTask,
        failTask,
        cancelTask,
        clearFinishedTasks,
        clearAllTasks,
        getTask,
        updateTaskMetadata,
    };
}

export default useAgentTaskSystem;
