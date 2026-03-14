import { useEffect, useRef, useCallback, useState } from 'react';
import { updatePresenceCursor } from '../services/firebase';
import type { OnlineUser } from './usePresence';

const THROTTLE_MS = 100; // Throttle cursor updates to 100ms

// Unique colors for each collaborator cursor
const CURSOR_COLORS = [
    '#3b82f6', // blue
    '#10b981', // emerald
    '#8b5cf6', // purple
    '#f59e0b', // amber
    '#ef4444', // red
    '#06b6d4', // cyan
    '#6366f1', // indigo
    '#ec4899', // pink
];

function getCursorColor(uid: string): string {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
        hash = ((hash << 5) - hash) + uid.charCodeAt(i);
        hash |= 0;
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

export interface CursorData {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
    x: number;
    y: number;
    color: string;
    lastSeen: number;
    elementId?: string;
}

interface UseLiveCursorsOptions {
    ownerUid: string;
    projectId: string;
    currentUserUid: string | null;
    otherUsers: OnlineUser[];
    enabled?: boolean;
    containerRef?: React.RefObject<HTMLElement>;
}

export function useLiveCursors({
    ownerUid,
    projectId,
    currentUserUid,
    otherUsers,
    enabled = true,
    containerRef,
}: UseLiveCursorsOptions) {
    const lastUpdateRef = useRef(0);
    const [cursors, setCursors] = useState<CursorData[]>([]);

    // Broadcast own cursor position
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!enabled || !currentUserUid || !ownerUid || !projectId) return;

        const now = Date.now();
        if (now - lastUpdateRef.current < THROTTLE_MS) return;
        lastUpdateRef.current = now;

        // Get position relative to the container or page
        let x = e.clientX;
        let y = e.clientY;

        if (containerRef?.current) {
            const rect = containerRef.current.getBoundingClientRect();
            x = e.clientX - rect.left;
            y = e.clientY - rect.top + containerRef.current.scrollTop;
        }

        // Find the nearest element with an id
        const target = e.target as HTMLElement;
        const closestWithId = target.closest('[id]');
        const elementId = closestWithId?.id;

        updatePresenceCursor(ownerUid, projectId, currentUserUid, x, y, elementId);
    }, [enabled, currentUserUid, ownerUid, projectId, containerRef]);

    // Attach mouse move listener
    useEffect(() => {
        if (!enabled) return;

        const target = containerRef?.current || document;
        target.addEventListener('mousemove', handleMouseMove as EventListener);
        return () => {
            target.removeEventListener('mousemove', handleMouseMove as EventListener);
        };
    }, [enabled, handleMouseMove, containerRef]);

    // Derive cursor positions from other users' presence data
    useEffect(() => {
        const now = Date.now();
        const activeCursors = otherUsers
            .filter(u => u.cursorX !== undefined && u.cursorY !== undefined && (now - u.lastSeen) < 5000)
            .map(u => ({
                uid: u.uid,
                displayName: u.displayName,
                photoURL: u.photoURL,
                x: u.cursorX!,
                y: u.cursorY!,
                color: getCursorColor(u.uid),
                lastSeen: u.lastSeen,
                elementId: u.cursorElementId,
            }));
        setCursors(activeCursors);
    }, [otherUsers]);

    return { cursors };
}
