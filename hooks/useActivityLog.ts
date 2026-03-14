import { useEffect, useState } from 'react';
import { subscribeToActivity } from '../services/firebase';
import { ProjectActivity } from '../types';

interface UseActivityLogOptions {
    ownerUid: string;
    projectId: string;
    maxItems?: number;
    enabled?: boolean;
}

export function useActivityLog({
    ownerUid,
    projectId,
    maxItems = 50,
    enabled = true,
}: UseActivityLogOptions) {
    const [activities, setActivities] = useState<ProjectActivity[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!ownerUid || !projectId || !enabled) {
            setActivities([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = subscribeToActivity(
            ownerUid,
            projectId,
            (newActivities) => {
                setActivities(newActivities);
                setLoading(false);
            },
            maxItems
        );

        return unsubscribe;
    }, [ownerUid, projectId, maxItems, enabled]);

    return { activities, loading };
}
