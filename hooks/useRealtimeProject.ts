import { useEffect, useRef } from 'react';
import { subscribeToProject } from '../services/firebase';
import { ResearchProject } from '../types';

interface UseRealtimeProjectOptions {
    ownerUid: string | undefined;
    projectId: string | undefined;
    enabled?: boolean;
    onUpdate: (project: ResearchProject) => void;
}

/**
 * Subscribes to realtime Firestore updates for a project document.
 * When any collaborator writes changes (notes, tasks, files, etc.),
 * the callback fires with the updated project data.
 */
export function useRealtimeProject({
    ownerUid,
    projectId,
    enabled = true,
    onUpdate,
}: UseRealtimeProjectOptions) {
    // Use a ref for the callback to avoid re-subscribing on every render
    const onUpdateRef = useRef(onUpdate);
    onUpdateRef.current = onUpdate;

    useEffect(() => {
        if (!ownerUid || !projectId || !enabled) return;

        console.log('[useRealtimeProject] Subscribing to project:', projectId, 'owner:', ownerUid);

        const unsubscribe = subscribeToProject(ownerUid, projectId, (updatedProject) => {
            console.log('[useRealtimeProject] Received update for project:', projectId);
            onUpdateRef.current(updatedProject);
        });

        return () => {
            console.log('[useRealtimeProject] Unsubscribing from project:', projectId);
            unsubscribe();
        };
    }, [ownerUid, projectId, enabled]);
}
