import React, { useState, useRef, useEffect } from 'react';
import { ProjectComment, CommentTargetType } from '../types';

interface CommentThreadProps {
    ownerUid: string;
    projectId: string;
    targetType: CommentTargetType;
    targetId: string;
    targetTitle: string;
    currentUserUid: string;
    currentUserName: string | null;
    currentUserPhoto: string | null;
    comments: ProjectComment[];
    getReplies: (parentId: string) => ProjectComment[];
    onAddComment: (input: {
        targetType: CommentTargetType;
        targetId: string;
        targetTitle: string;
        authorUid: string;
        authorName: string | null;
        authorPhoto: string | null;
        content: string;
        parentId?: string | null;
    }) => Promise<any>;
    onResolveComment: (commentId: string) => Promise<void>;
    onDeleteComment: (commentId: string) => Promise<void>;
    isDarkMode: boolean;
    canEdit: boolean;
    onClose: () => void;
}

function timeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

function getInitials(name: string | null, email?: string | null): string {
    if (name) {
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return parts[0].slice(0, 2).toUpperCase();
    }
    return '?';
}

const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];

function getColorFromUid(uid: string): string {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) hash = ((hash << 5) - hash) + uid.charCodeAt(i);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const CommentBubble: React.FC<{
    comment: ProjectComment;
    replies: ProjectComment[];
    currentUserUid: string;
    isDarkMode: boolean;
    canEdit: boolean;
    onReply: (parentId: string) => void;
    onResolve: (commentId: string) => void;
    onDelete: (commentId: string) => void;
    replyingTo: string | null;
    replyText: string;
    onReplyTextChange: (text: string) => void;
    onSubmitReply: () => void;
    currentUserName: string | null;
    currentUserPhoto: string | null;
}> = ({
    comment, replies, currentUserUid, isDarkMode, canEdit,
    onReply, onResolve, onDelete,
    replyingTo, replyText, onReplyTextChange, onSubmitReply,
    currentUserName, currentUserPhoto,
}) => {
        const isOwn = comment.authorUid === currentUserUid;

        return (
            <div className={`group ${comment.resolved ? 'opacity-60' : ''}`}>
                <div className={`flex gap-2.5 ${comment.resolved ? '' : ''}`}>
                    {/* Avatar */}
                    {comment.authorPhoto ? (
                        <img src={comment.authorPhoto} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0 mt-0.5" />
                    ) : (
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5 ${getColorFromUid(comment.authorUid)}`}>
                            {getInitials(comment.authorName)}
                        </div>
                    )}

                    <div className="flex-1 min-w-0">
                        {/* Header */}
                        <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-xs font-semibold ${isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-900'}`}>
                                {comment.authorName || 'Anonymous'}
                            </span>
                            <span className={`text-[10px] ${isDarkMode ? 'text-[#636366]' : 'text-gray-400'}`}>
                                {timeAgo(comment.createdAt)}
                            </span>
                            {comment.resolved && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-500 font-medium">Resolved</span>
                            )}
                        </div>

                        {/* Content */}
                        <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-[#b0b0b5]' : 'text-gray-700'}`}>
                            {comment.content}
                        </p>

                        {/* Actions */}
                        <div className="flex items-center gap-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canEdit && !comment.resolved && (
                                <button
                                    onClick={() => onReply(comment.id)}
                                    className={`text-[11px] font-medium ${isDarkMode ? 'text-[#0071e3] hover:text-[#4da3ff]' : 'text-blue-500 hover:text-blue-600'}`}
                                >
                                    Reply
                                </button>
                            )}
                            {canEdit && !comment.resolved && (
                                <button
                                    onClick={() => onResolve(comment.id)}
                                    className={`text-[11px] font-medium ${isDarkMode ? 'text-[#30d158] hover:text-[#34c759]' : 'text-green-500 hover:text-green-600'}`}
                                >
                                    Resolve
                                </button>
                            )}
                            {isOwn && (
                                <button
                                    onClick={() => onDelete(comment.id)}
                                    className={`text-[11px] font-medium ${isDarkMode ? 'text-[#ff453a] hover:text-[#ff6961]' : 'text-red-500 hover:text-red-600'}`}
                                >
                                    Delete
                                </button>
                            )}
                        </div>

                        {/* Replies */}
                        {replies.length > 0 && (
                            <div className={`mt-2 pl-3 border-l-2 space-y-2 ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                                {replies.map(reply => (
                                    <div key={reply.id} className="flex gap-2">
                                        {reply.authorPhoto ? (
                                            <img src={reply.authorPhoto} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0 mt-0.5" />
                                        ) : (
                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0 mt-0.5 ${getColorFromUid(reply.authorUid)}`}>
                                                {getInitials(reply.authorName)}
                                            </div>
                                        )}
                                        <div>
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-[11px] font-semibold ${isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-900'}`}>
                                                    {reply.authorName || 'Anonymous'}
                                                </span>
                                                <span className={`text-[9px] ${isDarkMode ? 'text-[#636366]' : 'text-gray-400'}`}>
                                                    {timeAgo(reply.createdAt)}
                                                </span>
                                            </div>
                                            <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-[#b0b0b5]' : 'text-gray-700'}`}>
                                                {reply.content}
                                            </p>
                                            {reply.authorUid === currentUserUid && (
                                                <button
                                                    onClick={() => onDelete(reply.id)}
                                                    className={`text-[10px] font-medium mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'text-[#ff453a]' : 'text-red-500'}`}
                                                >
                                                    Delete
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Reply input */}
                        {replyingTo === comment.id && (
                            <div className="mt-2 flex gap-2">
                                <input
                                    type="text"
                                    value={replyText}
                                    onChange={(e) => onReplyTextChange(e.target.value)}
                                    placeholder="Write a reply..."
                                    className={`flex-1 text-xs px-3 py-1.5 rounded-lg border outline-none ${isDarkMode
                                            ? 'bg-[#1d1d1f] border-[#3d3d3f] text-white placeholder-[#636366]'
                                            : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                                        }`}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && replyText.trim()) onSubmitReply();
                                    }}
                                    autoFocus
                                />
                                <button
                                    onClick={onSubmitReply}
                                    disabled={!replyText.trim()}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-[#0071e3] text-white font-medium disabled:opacity-50 hover:bg-[#0077ed] transition-colors"
                                >
                                    Reply
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

const CommentThread: React.FC<CommentThreadProps> = ({
    targetType,
    targetId,
    targetTitle,
    currentUserUid,
    currentUserName,
    currentUserPhoto,
    comments: allComments,
    getReplies,
    onAddComment,
    onResolveComment,
    onDeleteComment,
    isDarkMode,
    canEdit,
    onClose,
}) => {
    const [newComment, setNewComment] = useState('');
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyText, setReplyText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Filter to only show comments for this target
    const topLevelComments = allComments.filter(c => !c.parentId);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [allComments.length]);

    const handleSubmit = async () => {
        if (!newComment.trim() || submitting) return;
        setSubmitting(true);
        try {
            await onAddComment({
                targetType,
                targetId,
                targetTitle,
                authorUid: currentUserUid,
                authorName: currentUserName,
                authorPhoto: currentUserPhoto,
                content: newComment.trim(),
            });
            setNewComment('');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmitReply = async () => {
        if (!replyText.trim() || !replyingTo || submitting) return;
        setSubmitting(true);
        try {
            await onAddComment({
                targetType,
                targetId,
                targetTitle,
                authorUid: currentUserUid,
                authorName: currentUserName,
                authorPhoto: currentUserPhoto,
                content: replyText.trim(),
                parentId: replyingTo,
            });
            setReplyText('');
            setReplyingTo(null);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className={`flex flex-col h-full max-h-[400px] rounded-xl border ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200 shadow-lg'
            }`}>
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-100'
                }`}>
                <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                    <span className={`text-xs font-semibold ${isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-900'}`}>
                        Comments ({allComments.length})
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-[#86868b]' : 'hover:bg-gray-100 text-gray-400'
                        }`}
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Comments list */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {topLevelComments.length === 0 ? (
                    <div className={`text-center py-6 ${isDarkMode ? 'text-[#636366]' : 'text-gray-400'}`}>
                        <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                        </svg>
                        <p className="text-xs">No comments yet</p>
                    </div>
                ) : (
                    topLevelComments.map(comment => (
                        <CommentBubble
                            key={comment.id}
                            comment={comment}
                            replies={getReplies(comment.id)}
                            currentUserUid={currentUserUid}
                            isDarkMode={isDarkMode}
                            canEdit={canEdit}
                            onReply={(id) => setReplyingTo(replyingTo === id ? null : id)}
                            onResolve={onResolveComment}
                            onDelete={onDeleteComment}
                            replyingTo={replyingTo}
                            replyText={replyText}
                            onReplyTextChange={setReplyText}
                            onSubmitReply={handleSubmitReply}
                            currentUserName={currentUserName}
                            currentUserPhoto={currentUserPhoto}
                        />
                    ))
                )}
            </div>

            {/* Input */}
            {canEdit && (
                <div className={`px-4 py-3 border-t ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-100'}`}>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            placeholder="Write a comment..."
                            className={`flex-1 text-sm px-3 py-2 rounded-lg border outline-none transition-colors ${isDarkMode
                                    ? 'bg-[#2d2d2f] border-[#3d3d3f] text-white placeholder-[#636366] focus:border-[#0071e3]'
                                    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-500'
                                }`}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newComment.trim()) handleSubmit();
                            }}
                            disabled={submitting}
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={!newComment.trim() || submitting}
                            className="px-4 py-2 rounded-lg bg-[#0071e3] text-white text-sm font-medium disabled:opacity-50 hover:bg-[#0077ed] transition-colors"
                        >
                            {submitting ? '...' : 'Send'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CommentThread;
