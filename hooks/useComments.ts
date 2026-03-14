import { useEffect, useState, useCallback } from 'react';
import {
    addCommentToProject,
    updateCommentInProject,
    deleteCommentFromProject,
    subscribeToComments,
    logProjectActivity,
} from '../services/firebase';
import { ProjectComment, CommentTargetType } from '../types';

interface UseCommentsOptions {
    ownerUid: string;
    projectId: string;
    targetId?: string;
    enabled?: boolean;
}

export function useComments({
    ownerUid,
    projectId,
    targetId,
    enabled = true,
}: UseCommentsOptions) {
    const [comments, setComments] = useState<ProjectComment[]>([]);
    const [loading, setLoading] = useState(true);

    // Subscribe to comments
    useEffect(() => {
        if (!ownerUid || !projectId || !enabled) {
            setComments([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = subscribeToComments(
            ownerUid,
            projectId,
            (newComments) => {
                setComments(newComments);
                setLoading(false);
            },
            targetId
        );

        return unsubscribe;
    }, [ownerUid, projectId, targetId, enabled]);

    const addComment = useCallback(async (input: {
        targetType: CommentTargetType;
        targetId: string;
        targetTitle: string;
        authorUid: string;
        authorName: string | null;
        authorPhoto: string | null;
        content: string;
        parentId?: string | null;
    }) => {
        const comment = await addCommentToProject(ownerUid, projectId, {
            ...input,
            parentId: input.parentId || null,
            resolved: false,
        });

        // Log activity
        await logProjectActivity(ownerUid, projectId, {
            type: 'comment_added',
            actorUid: input.authorUid,
            actorName: input.authorName,
            actorPhoto: input.authorPhoto,
            description: `commented on ${input.targetType}: ${input.targetTitle}`,
            targetType: input.targetType,
            targetId: input.targetId,
        });

        return comment;
    }, [ownerUid, projectId]);

    const resolveComment = useCallback(async (commentId: string) => {
        await updateCommentInProject(ownerUid, projectId, commentId, { resolved: true });
    }, [ownerUid, projectId]);

    const unresolveComment = useCallback(async (commentId: string) => {
        await updateCommentInProject(ownerUid, projectId, commentId, { resolved: false });
    }, [ownerUid, projectId]);

    const editComment = useCallback(async (commentId: string, content: string) => {
        await updateCommentInProject(ownerUid, projectId, commentId, { content });
    }, [ownerUid, projectId]);

    const removeComment = useCallback(async (commentId: string) => {
        await deleteCommentFromProject(ownerUid, projectId, commentId);
    }, [ownerUid, projectId]);

    // Build threaded structure
    const topLevelComments = comments.filter(c => !c.parentId);
    const getReplies = (parentId: string) =>
        comments.filter(c => c.parentId === parentId);

    return {
        comments,
        topLevelComments,
        getReplies,
        addComment,
        resolveComment,
        unresolveComment,
        editComment,
        removeComment,
        loading,
        commentCount: comments.length,
    };
}
