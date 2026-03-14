import React, { useState, useEffect } from 'react';
import { ProjectTask, TaskPriority, TaskStatus } from '../types';

interface TaskDetailModalProps {
    task: ProjectTask;
    isOpen: boolean;
    onClose: () => void;
    onUpdate: (taskId: string, updates: Partial<ProjectTask>) => Promise<void>;
    onDelete: (taskId: string) => Promise<void>;
    isDarkMode: boolean;
    readOnly?: boolean;
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
    { value: 'low', label: 'Low', color: 'bg-slate-500' },
    { value: 'medium', label: 'Medium', color: 'bg-amber-500' },
    { value: 'high', label: 'High', color: 'bg-red-500' },
];

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'done', label: 'Done' },
];

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
    task,
    isOpen,
    onClose,
    onUpdate,
    onDelete,
    isDarkMode,
    readOnly = false,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description || '');
    const [priority, setPriority] = useState<TaskPriority>(task.priority);
    const [status, setStatus] = useState<TaskStatus>(task.status);
    const [dueDate, setDueDate] = useState(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : '');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setTitle(task.title);
            setDescription(task.description || '');
            setPriority(task.priority);
            setStatus(task.status);
            setDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : '');
            setIsEditing(false);
        }
    }, [isOpen, task]);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!title.trim()) return;
        setIsSaving(true);
        try {
            const updates: Partial<ProjectTask> = {
                title: title.trim(),
                description: description.trim(),
                priority,
                status,
                dueDate: dueDate ? new Date(dueDate).getTime() : undefined,
            };
            await onUpdate(task.id, updates);
            setIsEditing(false);
        } catch (error) {
            console.error('Failed to update task:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (confirm('Are you sure you want to delete this task?')) {
            await onDelete(task.id);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />
            <div
                className={`relative w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden transform transition-all flex flex-col max-h-[90vh] ${isDarkMode ? 'bg-[#1d1d1f] border border-[#3d3d3f]' : 'bg-white border border-gray-200'
                    }`}
            >
                {/* Header */}
                <div className={`flex items-start justify-between p-6 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-100'}`}>
                    <div className="flex-1 min-w-0 pr-4">
                        {isEditing ? (
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className={`w-full text-xl font-semibold bg-transparent outline-none border-b-2 transition-colors ${isDarkMode
                                    ? 'text-white border-blue-500/50 focus:border-blue-500'
                                    : 'text-gray-900 border-blue-200 focus:border-blue-500'
                                    }`}
                                placeholder="Task title"
                                autoFocus
                            />
                        ) : (
                            <h2 className={`text-xl font-semibold leading-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {task.title}
                            </h2>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
                            }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Status & Priority Row */}
                    <div className="flex flex-wrap gap-4">
                        <div className="space-y-1.5">
                            <label className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                Status
                            </label>
                            {isEditing ? (
                                <select
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                                    className={`block w-full px-3 py-1.5 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-blue-500/20 ${isDarkMode
                                        ? 'bg-[#2c2c2e] border-[#3d3d3f] text-white'
                                        : 'bg-white border-gray-200 text-gray-900'
                                        }`}
                                >
                                    {STATUS_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            ) : (
                                <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${status === 'done'
                                    ? (isDarkMode ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border-emerald-200')
                                    : status === 'in_progress'
                                        ? (isDarkMode ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-blue-50 text-blue-700 border-blue-200')
                                        : (isDarkMode ? 'bg-gray-500/10 text-gray-400 border-gray-500/20' : 'bg-gray-50 text-gray-600 border-gray-200')
                                    }`}>
                                    {STATUS_OPTIONS.find(s => s.value === status)?.label}
                                </div>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <label className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                Priority
                            </label>
                            {isEditing ? (
                                <select
                                    value={priority}
                                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                                    className={`block w-full px-3 py-1.5 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-blue-500/20 ${isDarkMode
                                        ? 'bg-[#2c2c2e] border-[#3d3d3f] text-white'
                                        : 'bg-white border-gray-200 text-gray-900'
                                        }`}
                                >
                                    {PRIORITY_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <span className={`w-2.5 h-2.5 rounded-full ${PRIORITY_OPTIONS.find(p => p.value === priority)?.color}`} />
                                    <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                        {PRIORITY_OPTIONS.find(p => p.value === priority)?.label}
                                    </span>
                                </div>
                            )}
                        </div>

                        {(isEditing || task.dueDate) && (
                            <div className="space-y-1.5">
                                <label className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    Due Date
                                </label>
                                {isEditing ? (
                                    <input
                                        type="datetime-local"
                                        value={dueDate}
                                        onChange={(e) => setDueDate(e.target.value)}
                                        className={`block w-full px-3 py-1.5 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-blue-500/20 ${isDarkMode
                                            ? 'bg-[#2c2c2e] border-[#3d3d3f] text-white calendar-dark'
                                            : 'bg-white border-gray-200 text-gray-900'
                                            }`}
                                    />
                                ) : (
                                    <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                        {new Date(task.dueDate!).toLocaleString(undefined, {
                                            dateStyle: 'medium',
                                            timeStyle: 'short'
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <label className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                            Description
                        </label>
                        {isEditing ? (
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={6}
                                className={`w-full px-4 py-3 rounded-xl text-sm leading-relaxed border outline-none focus:ring-2 focus:ring-blue-500/20 resize-none ${isDarkMode
                                    ? 'bg-[#2c2c2e] border-[#3d3d3f] text-white placeholder-gray-500'
                                    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                                    }`}
                                placeholder="Add a more detailed description..."
                            />
                        ) : (
                            <div className={`prose prose-sm max-w-none ${isDarkMode ? 'prose-invert text-gray-300' : 'text-gray-700'}`}>
                                {task.description ? (
                                    <p className="whitespace-pre-wrap leading-relaxed">{task.description}</p>
                                ) : (
                                    <p className="italic opacity-50">No description provided.</p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Meta Links (View Only) */}
                    {(!isEditing && (task.googleCalendarHtmlLink || task.googleMeetLink)) && (
                        <div className={`flex flex-wrap gap-3 pt-4 border-t ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-100'}`}>
                            {task.googleCalendarHtmlLink && (
                                <a
                                    href={task.googleCalendarHtmlLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDarkMode
                                        ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                                        : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                                        }`}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    View in Calendar
                                </a>
                            )}
                            {task.googleMeetLink && (
                                <a
                                    href={task.googleMeetLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDarkMode
                                        ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                                        : 'bg-green-50 text-green-700 hover:bg-green-100'
                                        }`}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    Join Meet
                                </a>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                {!readOnly && (
                    <div className={`p-4 sm:p-6 border-t flex items-center justify-between gap-4 ${isDarkMode ? 'border-[#3d3d3f] bg-[#2c2c2e]/50' : 'border-gray-100 bg-gray-50/50'}`}>
                        {isEditing ? (
                            <>
                                <button
                                    onClick={() => handleDelete()}
                                    className="px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                >
                                    Delete Task
                                </button>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${isDarkMode
                                            ? 'text-gray-300 hover:bg-white/5'
                                            : 'text-gray-600 hover:bg-gray-200'
                                            }`}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={isSaving}
                                        className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {isSaving ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => handleDelete()}
                                    className="px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                >
                                    Delete
                                </button>
                                <div className="flex items-center gap-3 ml-auto">
                                    <button
                                        onClick={onClose}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${isDarkMode
                                            ? 'text-gray-300 hover:bg-white/5'
                                            : 'text-gray-600 hover:bg-gray-200'
                                            }`}
                                    >
                                        Close
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className={`px-6 py-2 text-sm font-semibold rounded-lg transition-colors ${isDarkMode
                                            ? 'bg-white text-black hover:bg-gray-200'
                                            : 'bg-gray-900 text-white hover:bg-gray-800'
                                            }`}
                                    >
                                        Edit Task
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
