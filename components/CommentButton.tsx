import React, { useState, useRef, useEffect } from 'react';
import { CommentTargetType } from '../types';
import { useComments } from '../hooks/useComments';
import CommentThread from './CommentThread';

interface CommentButtonProps {
    ownerUid: string;
    projectId: string;
    targetType: CommentTargetType;
    targetId: string;
    targetTitle: string;
    currentUserUid: string;
    currentUserName: string | null;
    currentUserPhoto: string | null;
    isDarkMode: boolean;
    canEdit: boolean;
}

const CommentButton: React.FC<CommentButtonProps> = ({
    ownerUid,
    projectId,
    targetType,
    targetId,
    targetTitle,
    currentUserUid,
    currentUserName,
    currentUserPhoto,
    isDarkMode,
    canEdit,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {
        comments,
        topLevelComments,
        getReplies,
        addComment,
        resolveComment,
        removeComment,
        commentCount,
    } = useComments({
        ownerUid,
        projectId,
        targetId,
        enabled: true,
    });

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div className="relative inline-flex">
            <button
                ref={buttonRef}
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${isOpen
                        ? (isDarkMode ? 'bg-[#0071e3]/20 text-[#4da3ff]' : 'bg-blue-50 text-blue-600')
                        : (isDarkMode ? 'hover:bg-white/10 text-[#86868b]' : 'hover:bg-gray-100 text-gray-500')
                    }`}
                title="Comments"
            >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                {commentCount > 0 && (
                    <span className={`min-w-[16px] h-4 flex items-center justify-center text-[10px] font-bold rounded-full px-1 ${isDarkMode ? 'bg-[#0071e3] text-white' : 'bg-blue-500 text-white'
                        }`}>
                        {commentCount}
                    </span>
                )}
            </button>

            {/* Popover */}
            {isOpen && (
                <div
                    ref={popoverRef}
                    className="absolute right-0 top-full mt-2 w-[340px] z-50"
                    style={{ maxHeight: '70vh' }}
                >
                    <CommentThread
                        ownerUid={ownerUid}
                        projectId={projectId}
                        targetType={targetType}
                        targetId={targetId}
                        targetTitle={targetTitle}
                        currentUserUid={currentUserUid}
                        currentUserName={currentUserName}
                        currentUserPhoto={currentUserPhoto}
                        comments={comments}
                        getReplies={getReplies}
                        onAddComment={addComment}
                        onResolveComment={resolveComment}
                        onDeleteComment={removeComment}
                        isDarkMode={isDarkMode}
                        canEdit={canEdit}
                        onClose={() => setIsOpen(false)}
                    />
                </div>
            )}
        </div>
    );
};

export default CommentButton;
