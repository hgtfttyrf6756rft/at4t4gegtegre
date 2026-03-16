import React, { useEffect, useRef, useState } from 'react';
import { ProjectTask, TaskStatus, TaskPriority, ResearchProject } from '../types';
import { storageService } from '../services/storageService';
import { generateTasksFromResearch, AITaskSuggestion } from '../services/geminiService';
import { authFetch } from '../services/authFetch';
import { logProjectActivity, auth } from '../services/firebase';
import { TaskDetailModal } from './TaskDetailModal';

import { OnlineUser } from '../hooks/usePresence';

interface KanbanBoardProps {
  project: ResearchProject;
  onProjectUpdate: (project: ResearchProject) => void;
  isDarkMode?: boolean;
  readOnly?: boolean;
  initialTaskId?: string | null;
  updateFocus?: (itemId: string | null, itemType: 'note' | 'task' | 'file' | null) => void;
  onlineCollaborators?: OnlineUser[];
}

const COLUMNS: { id: TaskStatus; title: string; color: string; bgColor: string }[] = [
  { id: 'todo', title: 'To Do', color: 'text-slate-400', bgColor: 'bg-slate-500/10' },
  { id: 'in_progress', title: 'In Progress', color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  { id: 'done', title: 'Done', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' }
];

const PRIORITY_COLORS: Record<TaskPriority, { dot: string; light: string; dark: string }> = {
  low: { dot: 'bg-slate-400', light: 'bg-slate-500/5 text-slate-600', dark: 'bg-slate-500/20 text-slate-400' },
  medium: { dot: 'bg-amber-400', light: 'bg-amber-500/5 text-amber-700', dark: 'bg-amber-500/20 text-amber-400' },
  high: { dot: 'bg-red-400', light: 'bg-red-500/5 text-red-700', dark: 'bg-red-500/20 text-red-400' }
};

const PLATFORM_LOGOS: Record<string, string> = {
  facebook: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp',
  instagram: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp',
  tiktok: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/tiktok-6338432_1280.webp',
  youtube: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png',
  linkedin: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/LinkedIn_logo_initials.png',
  x: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/X-Logo-Round-Color.png',
};

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  project,
  onProjectUpdate,
  isDarkMode = true,
  readOnly = false,
  initialTaskId = null,
  updateFocus,
  onlineCollaborators = []
}) => {
  const [draggedTask, setDraggedTask] = useState<ProjectTask | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<TaskStatus | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const [isAddingTask, setIsAddingTask] = useState<TaskStatus | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AITaskSuggestion[]>([]);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<Array<{
    id: string;
    scheduledAt: number;
    platforms: string[];
    textContent: string;
    status: string;
  }>>([]);
  const [scheduledEmails, setScheduledEmails] = useState<Array<{
    id: string;
    scheduledAt: number;
    to: string | string[];
    subject: string;
    status: string;
    provider: 'gmail' | 'outlook';
  }>>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [schedulingTaskId, setSchedulingTaskId] = useState<string | null>(null);
  const [scheduleStartLocal, setScheduleStartLocal] = useState('');
  const [scheduleEndLocal, setScheduleEndLocal] = useState('');
  const [scheduleAddMeet, setScheduleAddMeet] = useState(true);

  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDescription, setNewEventDescription] = useState('');
  const [newEventStartLocal, setNewEventStartLocal] = useState('');
  const [newEventEndLocal, setNewEventEndLocal] = useState('');
  const [newEventAddMeet, setNewEventAddMeet] = useState(true);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isTouchDraggingRef = useRef(false);
  const [dragStartDate, setDragStartDate] = useState<Date | null>(null);
  const [dragEndDate, setDragEndDate] = useState<Date | null>(null);
  const isDraggingDateRef = useRef(false);
  const dragStartDateRef = useRef<Date | null>(null);
  const dragEndDateRef = useRef<Date | null>(null);

  // Prevent vertical scroll during touch drag of tasks
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (isTouchDraggingRef.current) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', handler, { passive: false });
    return () => document.removeEventListener('touchmove', handler);
  }, []);

  const tasks = project.tasks || [];

  useEffect(() => {
    if (initialTaskId) {
      const task = tasks.find(t => t.id === initialTaskId);
      if (task) {
        setEditingTask(task);
        // Wait for state update/render then scroll
        setTimeout(() => {
          const element = document.getElementById(`task-${initialTaskId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
            setTimeout(() => element.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2'), 3000);
          }
        }, 100);
      }
    }
  }, [initialTaskId, tasks]);

  const isReadOnly = !!readOnly;

  const pad2 = (n: number) => String(n).padStart(2, '0');

  const dateKeyLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  };

  const localInputFromMs = (ms: number) => {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    return `${y}-${m}-${day}T${hh}:${mm}`;
  };

  const msFromLocalInput = (value: string) => {
    const parsed = new Date(value);
    const ms = parsed.getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const getMonthStartEnd = (month: Date) => {
    const start = new Date(month);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return { start, end };
  };

  const getDefaultScheduleInputs = (day: Date) => {
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    const end = new Date(day);
    end.setHours(10, 0, 0, 0);
    return { startLocal: localInputFromMs(start.getTime()), endLocal: localInputFromMs(end.getTime()) };
  };



  const normalizeDay = (d: Date) => {
    const next = new Date(d);
    next.setHours(0, 0, 0, 0);
    return next;
  };

  const monthStartForDay = (d: Date) => {
    const next = new Date(d);
    next.setDate(1);
    next.setHours(0, 0, 0, 0);
    return next;
  };

  // Effect removed to prevent overwriting drag selection
  // useEffect(() => {
  //   if (!calendarOpen) return;
  //   const defaults = getDefaultScheduleInputs(selectedDate);
  //   setNewEventStartLocal(defaults.startLocal);
  //   setNewEventEndLocal(defaults.endLocal);
  // }, [calendarOpen, selectedDate]);

  const refreshCalendarStatus = async () => {
    try {
      const res = await authFetch('/api/google-calendar-status', { method: 'GET' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load Google Calendar status');
      }
      setCalendarConnected(Boolean(data?.connected));
      return Boolean(data?.connected);
    } catch (e: any) {
      setCalendarConnected(false);
      setCalendarError(e?.message || 'Failed to load Google Calendar status');
      return false;
    }
  };

  const handleCreateCalendarEvent = async () => {
    if (isReadOnly) return;
    const summary = newEventTitle.trim();
    if (!summary) {
      setCalendarError('Event title is required');
      return;
    }

    const startMs = msFromLocalInput(newEventStartLocal);
    const endMs = msFromLocalInput(newEventEndLocal);
    if (!startMs || !endMs || endMs <= startMs) {
      setCalendarError('Invalid start/end time');
      return;
    }

    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const res = await authFetch('/api/google-calendar-event-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarId: 'primary',
          summary,
          description: newEventDescription || '',
          startMs,
          endMs,
          addMeet: newEventAddMeet,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.needsReauth) {
          throw new Error('Google authorization needs to be refreshed');
        }
        throw new Error(data?.error || 'Failed to create event');
      }

      setNewEventTitle('');
      setNewEventDescription('');
      await loadCalendarEvents(calendarMonth);
    } catch (e: any) {
      setCalendarError(e?.message || 'Failed to create event');
    } finally {
      setCalendarLoading(false);
    }
  };

  const loadCalendarEvents = async (month: Date) => {
    const { start, end } = getMonthStartEnd(month);
    const qs = new URLSearchParams();
    qs.set('calendarId', 'primary');
    qs.set('timeMin', start.toISOString());
    qs.set('timeMax', end.toISOString());

    const res = await authFetch(`/api/google-calendar-events?${qs.toString()}`, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data?.needsReauth) {
        throw new Error('Google authorization needs to be refreshed');
      }
      throw new Error(data?.error || 'Failed to load Google Calendar events');
    }

    const events = Array.isArray(data?.events) ? data.events : [];
    setCalendarEvents(events);
  };

  const openCalendar = async () => {
    setCalendarOpen(true);
    setCalendarError(null);
    setCalendarLoading(true);
    try {
      const connected = await refreshCalendarStatus();
      if (connected) {
        await loadCalendarEvents(calendarMonth);
      }

      // Also fetch scheduled posts (regardless of Google Calendar connection)
      try {
        const postsRes = await authFetch('/api/social?op=schedule-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id }),
        });
        const postsData = await postsRes.json().catch(() => ({}));
        if (postsRes.ok && Array.isArray(postsData?.posts)) {
          setScheduledPosts(postsData.posts);
        }
      } catch (e) {
        console.error('Failed to load scheduled posts for calendar:', e);
      }

      // Also fetch scheduled emails
      try {
        const emailsRes = await authFetch('/api/email?op=email-schedule-list&projectId=' + encodeURIComponent(project.id), {
          method: 'GET',
        });
        const emailsData = await emailsRes.json().catch(() => ({}));
        if (emailsRes.ok && Array.isArray(emailsData?.emails)) {
          setScheduledEmails(emailsData.emails.filter((e: any) => e.status === 'scheduled'));
        }
      } catch (e) {
        console.error('Failed to load scheduled emails for calendar:', e);
      }
    } catch (e: any) {
      setCalendarError(e?.message || 'Failed to load calendar');
    } finally {
      setCalendarLoading(false);
    }
  };


  const openCalendarForTask = async (task: ProjectTask) => {
    const day = task.dueDate ? normalizeDay(new Date(task.dueDate)) : normalizeDay(new Date());
    const monthStart = monthStartForDay(day);
    setSelectedDate(day);
    setCalendarMonth(monthStart);
    setSchedulingTaskId(task.id);
    setScheduleAddMeet(Boolean(task.googleMeetLink) || !task.googleCalendarEventId);

    if (task.dueDate && task.dueDateEnd) {
      setScheduleStartLocal(localInputFromMs(task.dueDate));
      setScheduleEndLocal(localInputFromMs(task.dueDateEnd));
    } else {
      const defaults = getDefaultScheduleInputs(day);
      setScheduleStartLocal(defaults.startLocal);
      setScheduleEndLocal(defaults.endLocal);
    }

    await openCalendar();
  };

  useEffect(() => {
    if (!calendarOpen) return;

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || (event.data as any).type !== 'google-drive:connected') return;
      refreshCalendarStatus().then((connected) => {
        if (connected) {
          loadCalendarEvents(calendarMonth).catch(() => undefined);
        }
      });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [calendarOpen, calendarMonth]);

  const handleConnectGoogleCalendar = async () => {
    try {
      setCalendarError(null);
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const res = await authFetch(`/api/google-drive-auth-url?returnTo=${encodeURIComponent(returnTo)}`, {
        method: 'GET',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to start Google auth');
      }
      const url = String(data?.url || '').trim();
      if (!url) throw new Error('Missing auth url');
      const popup = window.open(url, 'googleDriveConnect', 'width=520,height=650');
      if (!popup) {
        window.location.assign(url);
      }
    } catch (e: any) {
      setCalendarError(e?.message || 'Failed to connect Google');
    }
  };

  const upsertCalendarEventForTask = async (task: ProjectTask, startMs: number, endMs: number) => {
    const res = await authFetch('/api/google-calendar-event-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarId: 'primary',
        eventId: task.googleCalendarEventId || undefined,
        summary: task.title,
        description: task.description || '',
        startMs,
        endMs,
        addMeet: scheduleAddMeet,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data?.needsReauth) {
        throw new Error('Google authorization needs to be refreshed');
      }
      throw new Error(data?.error || 'Failed to schedule task');
    }
    return data as { eventId?: string; htmlLink?: string; meetLink?: string };
  };

  const deleteCalendarEventForTask = async (task: ProjectTask) => {
    if (!task.googleCalendarEventId) return;
    const res = await authFetch('/api/google-calendar-event-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId: 'primary', eventId: task.googleCalendarEventId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data?.needsReauth) {
        throw new Error('Google authorization needs to be refreshed');
      }
      throw new Error(data?.error || 'Failed to unschedule task');
    }
  };

  const handleStartScheduling = (task: ProjectTask) => {
    setSchedulingTaskId(task.id);
    setScheduleAddMeet(Boolean(task.googleMeetLink) || !task.googleCalendarEventId);
    if (task.dueDate && task.dueDateEnd) {
      setScheduleStartLocal(localInputFromMs(task.dueDate));
      setScheduleEndLocal(localInputFromMs(task.dueDateEnd));
      return;
    }
    const defaults = getDefaultScheduleInputs(selectedDate);
    setScheduleStartLocal(defaults.startLocal);
    setScheduleEndLocal(defaults.endLocal);
  };

  const handleConfirmSchedule = async (task: ProjectTask) => {
    if (isReadOnly) return;
    const startMs = msFromLocalInput(scheduleStartLocal);
    const endMs = msFromLocalInput(scheduleEndLocal);
    if (!startMs || !endMs || endMs <= startMs) {
      setCalendarError('Invalid start/end time');
      return;
    }

    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const result = await upsertCalendarEventForTask(task, startMs, endMs);

      const updates: Partial<ProjectTask> = {
        dueDate: startMs,
        dueDateEnd: endMs,
        googleCalendarEventId: result?.eventId ? String(result.eventId) : undefined,
        googleCalendarHtmlLink: result?.htmlLink ? String(result.htmlLink) : undefined,
        googleMeetLink: result?.meetLink ? String(result.meetLink) : undefined,
      };

      await storageService.updateTask(project.id, task.id, updates);
      const nextTasks = (project.tasks || []).map(t => (t.id === task.id ? { ...t, ...updates } : t));
      onProjectUpdate({ ...project, tasks: nextTasks });

      setSchedulingTaskId(null);
      await loadCalendarEvents(calendarMonth);
    } catch (e: any) {
      setCalendarError(e?.message || 'Failed to schedule task');
    } finally {
      setCalendarLoading(false);
    }
  };

  const handleUnschedule = async (task: ProjectTask) => {
    if (isReadOnly) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      await deleteCalendarEventForTask(task);

      const updates: Partial<ProjectTask> = {
        dueDate: undefined,
        dueDateEnd: undefined,
        googleCalendarEventId: undefined,
        googleCalendarHtmlLink: undefined,
        googleMeetLink: undefined,
      };

      await storageService.updateTask(project.id, task.id, updates);
      const nextTasks = (project.tasks || []).map(t => (t.id === task.id ? { ...t, ...updates } : t));
      onProjectUpdate({ ...project, tasks: nextTasks });

      setSchedulingTaskId(null);
      await loadCalendarEvents(calendarMonth);
    } catch (e: any) {
      setCalendarError(e?.message || 'Failed to unschedule task');
    } finally {
      setCalendarLoading(false);
    }
  };

  const eventsByDayKey = () => {
    const map = new Map<string, any[]>();
    for (const ev of calendarEvents) {
      const start = ev?.start;
      const dateStr = typeof start?.date === 'string' ? start.date : '';
      const dateTimeStr = typeof start?.dateTime === 'string' ? start.dateTime : '';
      const key = dateStr || (dateTimeStr ? dateKeyLocal(new Date(dateTimeStr)) : '');
      if (!key) continue;
      const existing = map.get(key) || [];
      existing.push(ev);
      map.set(key, existing);
    }

    // Add scheduled posts to the map
    for (const post of scheduledPosts) {
      const postDate = new Date(post.scheduledAt * 1000);
      const key = dateKeyLocal(postDate);
      const existing = map.get(key) || [];
      existing.push({
        id: `scheduled-${post.id}`,
        summary: `📱 ${post.platforms?.join?.(', ') || 'Social'} post`,
        start: { dateTime: postDate.toISOString() },
        isScheduledPost: true,
        platforms: post.platforms,
        textContent: post.textContent,
        status: post.status,
      });
      map.set(key, existing);
    }

    // Add scheduled emails to the map
    for (const email of scheduledEmails) {
      const emailDate = new Date(email.scheduledAt * 1000);
      const key = dateKeyLocal(emailDate);
      const existing = map.get(key) || [];
      const recipientCount = Array.isArray(email.to) ? email.to.length : 1;
      existing.push({
        id: `scheduled-email-${email.id}`,
        summary: `✉️ Email: ${email.subject}`,
        start: { dateTime: emailDate.toISOString() },
        isScheduledEmail: true,
        to: email.to,
        subject: email.subject,
        status: email.status,
        provider: email.provider,
        recipientCount,
      });
      map.set(key, existing);
    }

    return map;
  };

  const selectedDayKey = dateKeyLocal(selectedDate);
  const selectedDayEvents = (eventsByDayKey().get(selectedDayKey) || []).slice(0, 25);

  const getTasksByStatus = (status: TaskStatus) =>
    tasks.filter(t => t.status === status).sort((a, b) => a.order - b.order);

  const handleDragStart = (e: React.DragEvent, task: ProjectTask) => {
    if (isReadOnly) return;
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';

    // Create a custom drag image that follows the cursor
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const clone = target.cloneNode(true) as HTMLDivElement;
    clone.style.position = 'fixed';
    clone.style.top = '-9999px';
    clone.style.left = '-9999px';
    clone.style.width = `${rect.width}px`;
    clone.style.opacity = '0.9';
    clone.style.transform = 'rotate(2deg)';
    clone.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '9999';
    document.body.appendChild(clone);
    dragImageRef.current = clone;
    e.dataTransfer.setDragImage(clone, rect.width / 2, 20);

    // Clean up the clone after a short delay
    setTimeout(() => {
      if (dragImageRef.current && dragImageRef.current.parentNode) {
        dragImageRef.current.parentNode.removeChild(dragImageRef.current);
        dragImageRef.current = null;
      }
    }, 0);
  };

  const handleDragOver = (e: React.DragEvent, columnId?: TaskStatus) => {
    if (isReadOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (columnId && dragOverColumnId !== columnId) {
      setDragOverColumnId(columnId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the column element itself
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverColumnId(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverColumnId(null);
    if (dragImageRef.current && dragImageRef.current.parentNode) {
      dragImageRef.current.parentNode.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }
  };

  const moveTask = async (targetStatus: TaskStatus, targetTaskId?: string, placeAfter = false) => {
    if (!draggedTask || isReadOnly) return;

    const sourceStatus = draggedTask.status;
    const withoutDragged = tasks.filter(t => t.id !== draggedTask.id);

    const targetColumnTasks = withoutDragged
      .filter(t => t.status === targetStatus)
      .sort((a, b) => a.order - b.order);

    let insertIndex = targetColumnTasks.length;

    if (targetTaskId) {
      const targetIndex = targetColumnTasks.findIndex(t => t.id === targetTaskId);
      if (targetIndex !== -1) {
        insertIndex = targetIndex + (placeAfter ? 1 : 0);
      }
    }

    const updatedDragged: ProjectTask = {
      ...draggedTask,
      status: targetStatus,
    };

    const newTargetColumn = [
      ...targetColumnTasks.slice(0, insertIndex),
      updatedDragged,
      ...targetColumnTasks.slice(insertIndex),
    ].map((task, index) => ({ ...task, order: index }));

    const remainingTasks = withoutDragged.filter(
      t => t.status !== targetStatus && t.status !== sourceStatus
    );

    let resultTasks = remainingTasks;

    if (sourceStatus !== targetStatus) {
      const sourceColumnTasks = withoutDragged
        .filter(t => t.status === sourceStatus)
        .sort((a, b) => a.order - b.order)
        .map((task, index) => ({ ...task, order: index }));

      resultTasks = resultTasks.concat(sourceColumnTasks);
    }

    resultTasks = resultTasks.concat(newTargetColumn);

    await storageService.reorderTasks(project.id, resultTasks);
    onProjectUpdate({ ...project, tasks: resultTasks });

    if (sourceStatus !== targetStatus) {
      const targetTitle = COLUMNS.find(c => c.id === targetStatus)?.title || targetStatus;
      await logProjectActivity(project.ownerUid, project.id, {
        type: targetStatus === 'done' ? 'task_completed' : 'project_updated',
        description: targetStatus === 'done'
          ? `completed task "${draggedTask.title}"`
          : `moved task "${draggedTask.title}" to ${targetTitle}`,
        actorUid: auth.currentUser?.uid || 'unknown',
        actorName: auth.currentUser?.displayName || 'Unknown',
        actorPhoto: auth.currentUser?.photoURL || undefined,
        metadata: { taskId: draggedTask.id, oldStatus: sourceStatus, newStatus: targetStatus }
      });
    }

    setDraggedTask(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    setDragOverColumnId(null);
    if (!draggedTask || isReadOnly) {
      setDraggedTask(null);
      return;
    }

    await moveTask(targetStatus);
  };

  const handleTaskDrop = async (
    e: React.DragEvent<HTMLDivElement>,
    targetStatus: TaskStatus,
    targetTaskId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedTask) {
      return;
    }

    if (draggedTask.id === targetTaskId && draggedTask.status === targetStatus) {
      setDraggedTask(null);
      return;
    }

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const placeAfter = offsetY > rect.height / 2;

    await moveTask(targetStatus, targetTaskId, placeAfter);
  };

  const handleTouchStart = (e: React.TouchEvent, task: ProjectTask) => {
    if (isReadOnly || e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    isTouchDraggingRef.current = false;
    setDraggedTask(task);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isReadOnly || !draggedTask || !touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 8) {
      isTouchDraggingRef.current = true;
    }
  };

  const handleTouchEnd = async (e: React.TouchEvent) => {
    if (isReadOnly || !draggedTask) return;

    const touch = e.changedTouches[0];
    if (!touch || !isTouchDraggingRef.current) {
      setDraggedTask(null);
      touchStartRef.current = null;
      isTouchDraggingRef.current = false;
      return;
    }

    if (typeof document === 'undefined') {
      setDraggedTask(null);
      touchStartRef.current = null;
      isTouchDraggingRef.current = false;
      return;
    }

    const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
    if (!el) {
      setDraggedTask(null);
      touchStartRef.current = null;
      isTouchDraggingRef.current = false;
      return;
    }

    let taskNode: HTMLElement | null = el;
    let targetTaskId: string | undefined;

    while (taskNode) {
      if (taskNode.dataset.taskId) {
        targetTaskId = taskNode.dataset.taskId;
        break;
      }
      taskNode = taskNode.parentElement;
    }

    let columnNode: HTMLElement | null = taskNode || el;
    let targetStatus: TaskStatus | null = null;

    while (columnNode) {
      if (columnNode.dataset.columnId) {
        targetStatus = columnNode.dataset.columnId as TaskStatus;
        break;
      }
      columnNode = columnNode.parentElement;
    }

    if (!targetStatus) {
      setDraggedTask(null);
      touchStartRef.current = null;
      isTouchDraggingRef.current = false;
      return;
    }

    let placeAfter = false;
    if (targetTaskId && taskNode) {
      const rect = taskNode.getBoundingClientRect();
      const offsetY = touch.clientY - rect.top;
      placeAfter = offsetY > rect.height / 2;
    }

    await moveTask(targetStatus, targetTaskId, placeAfter);

    touchStartRef.current = null;
    isTouchDraggingRef.current = false;
  };

  const handleTouchCancel = () => {
    setDraggedTask(null);
    touchStartRef.current = null;
    isTouchDraggingRef.current = false;
  };

  const handleAddTask = async (status: TaskStatus, options?: { schedule?: boolean }) => {
    if (isReadOnly || !newTaskTitle.trim()) return;
    const newTask = await storageService.addTask(project.id, {
      title: newTaskTitle.trim(),
      status,
      priority: newTaskPriority
    });

    onProjectUpdate({ ...project, tasks: [...tasks, newTask] });
    setNewTaskTitle('');
    setIsAddingTask(null);

    await logProjectActivity(project.ownerUid, project.id, {
      type: 'task_added',
      description: `added task "${newTask.title}"`,
      actorUid: auth.currentUser?.uid || 'unknown',
      actorName: auth.currentUser?.displayName || 'Unknown',
      actorPhoto: auth.currentUser?.photoURL || undefined,
      metadata: { taskId: newTask.id, status }
    });

    if (options?.schedule) {
      setSchedulingTaskId(newTask.id);
      const day = normalizeDay(new Date());
      const monthStart = monthStartForDay(day);
      setSelectedDate(day);
      setCalendarMonth(monthStart);
      setScheduleAddMeet(true);
      const defaults = getDefaultScheduleInputs(day);
      setScheduleStartLocal(defaults.startLocal);
      setScheduleEndLocal(defaults.endLocal);
      await openCalendar();
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (isReadOnly) return;
    await storageService.deleteTask(project.id, taskId);
    const taskTitle = tasks.find(t => t.id === taskId)?.title || 'task';
    onProjectUpdate({ ...project, tasks: tasks.filter(t => t.id !== taskId) });

    await logProjectActivity(project.ownerUid, project.id, {
      type: 'project_updated',
      description: `deleted task "${taskTitle}"`,
      actorUid: auth.currentUser?.uid || 'unknown',
      actorName: auth.currentUser?.displayName || 'Unknown',
      actorPhoto: auth.currentUser?.photoURL || undefined,
      metadata: { taskId }
    });
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<ProjectTask>) => {
    if (isReadOnly) return;
    await storageService.updateTask(project.id, taskId, updates);
    onProjectUpdate({
      ...project,
      tasks: tasks.map(t => t.id === taskId ? { ...t, ...updates } : t)
    });
    setEditingTask(null);
  };

  const handleGenerateFromResearch = async () => {
    if (isReadOnly || project.researchSessions.length === 0) return;

    setIsGeneratingTasks(true);
    try {
      const latestResearch = project.researchSessions[0];
      const suggestions = await generateTasksFromResearch(
        latestResearch.researchReport,
        project.name
      );
      setAiSuggestions(suggestions);
    } catch (error) {
      console.error('Failed to generate tasks:', error);
    }
    setIsGeneratingTasks(false);
  };

  const handleAcceptSuggestion = async (suggestion: AITaskSuggestion) => {
    if (isReadOnly) return;
    const newTask = await storageService.addTask(project.id, {
      title: suggestion.title,
      description: suggestion.description,
      status: 'todo',
      priority: suggestion.priority,
      aiGenerated: true,
      sourceResearchId: project.researchSessions[0]?.id
    });

    onProjectUpdate({ ...project, tasks: [...tasks, newTask] });
    setAiSuggestions(prev => prev.filter(s => s.title !== suggestion.title));
  };

  const handleDateDragStart = (d: Date) => {
    if (!calendarOpen) return;
    setDragStartDate(d);
    setDragEndDate(d);
    dragStartDateRef.current = d;
    dragEndDateRef.current = d;
    isDraggingDateRef.current = true;
  };

  const handleDateDragEnter = (d: Date) => {
    if (isDraggingDateRef.current) {
      setDragEndDate(d);
      dragEndDateRef.current = d;
    }
  };

  const handleDateDragEnd = () => {
    // Read from refs to avoid stale state in closure
    const dStart = dragStartDateRef.current;
    const dEnd = dragEndDateRef.current;

    if (!isDraggingDateRef.current || !dStart || !dEnd) return;
    isDraggingDateRef.current = false;

    const start = new Date(Math.min(dStart.getTime(), dEnd.getTime()));
    const end = new Date(Math.max(dStart.getTime(), dEnd.getTime()));

    setSelectedDate(start);

    // Create Event Logic - ALWAYS update these defaults when a range is selected
    // Default: Start 9:00 AM on first day, End 10:00 AM on last day
    const s = new Date(start);
    s.setHours(9, 0, 0, 0);
    const sStr = localInputFromMs(s.getTime());

    const e = new Date(end);
    e.setHours(10, 0, 0, 0);
    const eStr = localInputFromMs(e.getTime());

    // Hardcoded values removed
    setNewEventStartLocal(sStr);
    setNewEventEndLocal(eStr);

    if (schedulingTaskId) {
      const updateDatePreservingTime = (isoString: string, newDateTarget: Date) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        const newDate = new Date(newDateTarget);
        newDate.setHours(date.getHours(), date.getMinutes());
        const pad = (n: number) => n < 10 ? '0' + n : n;
        return `${newDate.getFullYear()}-${pad(newDate.getMonth() + 1)}-${pad(newDate.getDate())}T${pad(newDate.getHours())}:${pad(newDate.getMinutes())}`;
      };

      if (scheduleStartLocal) setScheduleStartLocal(updateDatePreservingTime(scheduleStartLocal, start));
      if (scheduleEndLocal) setScheduleEndLocal(updateDatePreservingTime(scheduleEndLocal, end));
    } else {
      setSchedulingTaskId(null);
    }

    setDragStartDate(null);
    setDragEndDate(null);
    dragStartDateRef.current = null;
    dragEndDateRef.current = null;
  };

  const handleDateTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const dateStr = el?.closest('[data-date]')?.getAttribute('data-date');
    if (dateStr) {
      handleDateDragStart(new Date(dateStr));
    }
  };

  const handleDateTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingDateRef.current) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const dateStr = el?.closest('[data-date]')?.getAttribute('data-date');
    if (dateStr) {
      handleDateDragEnter(new Date(dateStr));
    }
  };


  return (
    <>
      <div className="flex flex-col h-auto md:h-full">
        {/* Header with AI Actions */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-3">
            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="sm:hidden">Tasks</span>
              <span className="hidden sm:inline">Task Board</span>
            </h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isDarkMode ? 'text-slate-500 bg-slate-800' : 'text-gray-600 bg-gray-100'}`}>
              {tasks.length} <span className="hidden sm:inline">tasks</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={openCalendar}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode
                ? 'bg-white/5 hover:bg-white/10 text-slate-200'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Calendar</span>
            </button>
            {project.researchSessions.length > 0 && !isReadOnly && (
              <button
                onClick={handleGenerateFromResearch}
                disabled={isGeneratingTasks}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${isDarkMode
                  ? 'bg-violet-600/20 hover:bg-violet-600/30 text-violet-300'
                  : 'bg-violet-100 hover:bg-violet-200 text-violet-700'
                  }`}
              >
                {isGeneratingTasks ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="sm:hidden">AI Generate</span>
                    <span className="hidden sm:inline">AI: Generate from Research</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* AI Suggestions Panel */}
        {aiSuggestions.length > 0 && (
          <div
            className={`mb-4 p-3 rounded-xl border ${isDarkMode
              ? 'bg-violet-500/10 border-violet-500/20'
              : 'bg-violet-50 border-violet-200'
              }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className={`text-xs font-medium flex items-center gap-1.5 ${isDarkMode ? 'text-violet-300' : 'text-violet-700'
                  }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Task Suggestions
              </span>
              <button
                onClick={() => setAiSuggestions([])}
                className={`text-xs transition-colors ${isDarkMode ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                Dismiss all
              </button>
            </div>
            <div className="space-y-2">
              {aiSuggestions.map((suggestion, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 p-2 rounded-lg ${isDarkMode ? 'bg-slate-800/50' : 'bg-white shadow-sm border border-violet-100'
                    }`}
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}
                    >
                      {suggestion.title}
                    </p>
                    <p
                      className={`text-xs line-clamp-1 ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}
                    >
                      {suggestion.description}
                    </p>
                    {suggestion.sourceInsight && (
                      <p
                        className={`text-xs mt-1 italic ${isDarkMode ? 'text-violet-400' : 'text-violet-700'
                          }`}
                      >
                        "{suggestion.sourceInsight}"
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? PRIORITY_COLORS[suggestion.priority].dark : PRIORITY_COLORS[suggestion.priority].light}`}>
                      {suggestion.priority}
                    </span>
                    <button
                      onClick={() => handleAcceptSuggestion(suggestion)}
                      className={`p-1 rounded transition-colors ${isDarkMode
                        ? 'bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600'
                        }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Kanban Columns */}
        <div className="grid grid-cols-1 gap-3 md:flex-1 md:grid-cols-3 md:min-h-0">
          {COLUMNS.map(column => (
            <div
              key={column.id}
              data-column-id={column.id}
              className={`flex flex-col rounded-xl overflow-hidden border transition-all duration-200 ${isDarkMode ? `${column.bgColor} border-white/5` : 'bg-white border-gray-200'
                } ${dragOverColumnId === column.id ? (isDarkMode ? 'ring-2 ring-blue-500/50 border-blue-500/30 bg-blue-500/5' : 'ring-2 ring-blue-400 border-blue-300 bg-blue-50') : ''}`}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              {/* Column Header */}
              <div className={`flex items-center justify-between p-3 border-b ${isDarkMode ? 'border-white/5' : 'border-gray-200'
                }`}>
                <div className="flex items-center gap-2">
                  <span className={`font-medium text-sm ${column.color}`}>{column.title}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${isDarkMode ? 'text-slate-500 bg-slate-800/50' : 'text-gray-600 bg-gray-100'
                      }`}
                  >
                    {getTasksByStatus(column.id).length}
                  </span>
                </div>
                {!isReadOnly && (
                  <button
                    onClick={() => setIsAddingTask(column.id)}
                    className={`p-2 hover:bg-white/10 rounded transition-colors ${isDarkMode ? 'text-slate-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                      }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Tasks */}
              <div className="p-2 space-y-2 md:flex-1 md:overflow-y-auto">
                {/* Add Task Form */}
                {isAddingTask === column.id && !isReadOnly && (
                  <div
                    className={`p-2 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-white/10' : 'bg-white border-gray-200'
                      }`}
                  >
                    <div className="mt-2 text-left">
                      <div className="relative">
                        <input
                          type="text"
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="Task title..."
                          className={`w-full bg-transparent text-base outline-none mb-2 pr-8 ${isDarkMode ? 'text-white placeholder-slate-500' : 'text-gray-900 placeholder-gray-400'
                            }`}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddTask(column.id);
                            if (e.key === 'Escape') setIsAddingTask(null);
                          }}
                        />
                        <button
                          onClick={() => setIsAddingTask(null)}
                          className={`absolute right-0 top-0 p-1 rounded-full ${isDarkMode ? 'text-slate-500 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                        <div className={`flex rounded-lg p-0.5 shrink-0 ${isDarkMode ? 'bg-slate-800/50 border border-white/10' : 'bg-gray-50 border border-gray-100'}`}>
                          {(['low', 'medium', 'high'] as TaskPriority[]).map(p => (
                            <button
                              key={p}
                              onClick={() => setNewTaskPriority(p)}
                              className={`px-2 py-1.5 rounded-md text-[10px] uppercase font-bold tracking-wider transition-all ${newTaskPriority === p
                                ? `${isDarkMode ? PRIORITY_COLORS[p].dark : PRIORITY_COLORS[p].light} shadow-sm`
                                : isDarkMode
                                  ? 'text-slate-500 hover:text-slate-300'
                                  : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>

                        <div className="flex-1"></div>

                        <button
                          onClick={() => handleAddTask(column.id, { schedule: true })}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${isDarkMode
                            ? 'bg-white/5 hover:bg-white/10 text-slate-200 border-white/10'
                            : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                        >
                          Schedule
                        </button>
                        <button
                          onClick={() => handleAddTask(column.id)}
                          className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 whitespace-nowrap"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Task Cards */}
                {getTasksByStatus(column.id).map(task => (
                  <div
                    key={task.id}
                    id={`task-${task.id}`}
                    draggable={!isReadOnly}
                    onDragStart={(e) => handleDragStart(e, task)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, column.id)}
                    onDrop={(e) => handleTaskDrop(e, column.id, task.id)}
                    data-task-id={task.id}
                    onTouchStart={(e) => handleTouchStart(e, task)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchCancel}
                    onClick={() => setEditingTask(task)}
                    className={`group p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-all touch-none ${isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 border-white/5 hover:border-white/10'
                      : 'bg-white hover:bg-gray-50 border-gray-200 hover:border-gray-300'
                      } ${draggedTask?.id === task.id ? 'opacity-50 scale-95' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_COLORS[task.priority].dot}`} />
                          <span
                            className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'
                              }`}
                          >
                            {task.title}
                          </span>
                        </div>
                        {task.description && (
                          <p
                            className={`text-xs line-clamp-2 ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                              }`}
                          >
                            {task.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          {(task.googleCalendarEventId || task.dueDate) && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${isDarkMode
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'bg-blue-100 text-blue-700 border border-blue-200'
                                }`}
                            >
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              Scheduled
                            </span>
                          )}
                        </div>

                        {typeof task.dueDate === 'number' && task.dueDate > 0 && (
                          <div className={`mt-1 text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                            {(() => {
                              const start = new Date(task.dueDate as number);
                              const endMs = typeof task.dueDateEnd === 'number' ? (task.dueDateEnd as number) : 0;
                              const end = endMs ? new Date(endMs) : null;
                              const startStr = start.toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              });
                              if (!end) return startStr;
                              const endStr = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                              return `${startStr}–${endStr}`;
                            })()}
                          </div>
                        )}
                      </div>
                      {!isReadOnly && (
                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          {!task.dueDate && !task.googleCalendarEventId && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openCalendarForTask(task).catch(() => undefined);
                              }}
                              className="p-2 text-slate-400 hover:bg-blue-500/10 hover:text-blue-500 rounded-lg transition-colors"
                              title="Schedule"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTask(task.id);
                            }}
                            className="p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {getTasksByStatus(column.id).length === 0 && isAddingTask !== column.id && (
                  <div className="flex items-center justify-center h-20 text-slate-600 text-xs">
                    {isReadOnly ? 'No tasks' : 'Drop tasks here'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {calendarOpen && (
        <div className="relative z-50">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          <div
            className="fixed inset-0 z-10 w-screen overflow-y-auto"
            onClick={() => {
              if (calendarLoading) return;
              setCalendarOpen(false);
              setSchedulingTaskId(null);
            }}
          >
            <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
              <div
                className={`relative transform text-left w-full max-w-5xl rounded-2xl border shadow-2xl overflow-hidden ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'
                  }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Calendar</span>
                    {!calendarConnected && (
                      <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>Not connected</span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (calendarLoading) return;
                      setCalendarOpen(false);
                      setSchedulingTaskId(null);
                    }}
                    className={`p-3 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-gray-100 text-gray-600'
                      }`}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-4">
                  {calendarError && (
                    <div className={`mb-3 text-xs ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>{calendarError}</div>
                  )}

                  {!calendarConnected ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                        Connect Google to view events and sync tasks.
                      </div>
                      <button
                        onClick={handleConnectGoogleCalendar}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-500"
                      >
                        Connect Google
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="order-2 lg:order-1 lg:row-span-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={async () => {
                                if (calendarLoading) return;
                                const next = new Date(calendarMonth);
                                next.setMonth(next.getMonth() - 1);
                                next.setDate(1);
                                setCalendarMonth(next);
                                setCalendarLoading(true);
                                try {
                                  await loadCalendarEvents(next);
                                } catch (e: any) {
                                  setCalendarError(e?.message || 'Failed to load calendar events');
                                } finally {
                                  setCalendarLoading(false);
                                }
                              }}
                              className={`p-2 rounded ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-gray-100 text-gray-600'}`}
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                              </svg>
                            </button>
                            <button
                              onClick={async () => {
                                if (calendarLoading) return;
                                const next = new Date(calendarMonth);
                                next.setMonth(next.getMonth() + 1);
                                next.setDate(1);
                                setCalendarMonth(next);
                                setCalendarLoading(true);
                                try {
                                  await loadCalendarEvents(next);
                                } catch (e: any) {
                                  setCalendarError(e?.message || 'Failed to load calendar events');
                                } finally {
                                  setCalendarLoading(false);
                                }
                              }}
                              className={`p-2 rounded ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-gray-100 text-gray-600'}`}
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        <div className={`grid grid-cols-7 gap-1 text-[10px] mb-1 ${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                            <div key={d} className="text-center">{d}</div>
                          ))}
                        </div>

                        {(() => {
                          const monthStart = new Date(calendarMonth);
                          monthStart.setDate(1);
                          monthStart.setHours(0, 0, 0, 0);
                          const firstDow = monthStart.getDay();
                          const gridStart = new Date(monthStart);
                          gridStart.setDate(monthStart.getDate() - firstDow);
                          const byDay = eventsByDayKey();

                          const cells = new Array(42).fill(null).map((_, idx) => {
                            const d = new Date(gridStart);
                            d.setDate(gridStart.getDate() + idx);
                            d.setHours(0, 0, 0, 0);
                            const key = dateKeyLocal(d);
                            const isCurrentMonth = d.getMonth() === monthStart.getMonth();
                            const isSelected = key === selectedDayKey;

                            let isInDragRange = false;
                            if (dragStartDate && dragEndDate) {
                              const t = d.getTime();
                              const s = Math.min(dragStartDate.getTime(), dragEndDate.getTime());
                              const e = Math.max(dragStartDate.getTime(), dragEndDate.getTime());
                              isInDragRange = t >= s && t <= e;
                            }

                            const count = (byDay.get(key) || []).length;
                            return (
                              <button
                                key={key}
                                data-date={d.toISOString()}
                                onMouseDown={(e) => {
                                  if (e.button === 0) handleDateDragStart(d);
                                }}
                                onMouseEnter={() => handleDateDragEnter(d)}
                                onMouseUp={handleDateDragEnd}
                                className={`h-14 rounded-lg border flex flex-col items-center justify-center transition-colors select-none ${isInDragRange
                                  ? isDarkMode ? 'bg-blue-500/40 border-blue-500/60' : 'bg-blue-100 border-blue-300'
                                  : isSelected
                                    ? isDarkMode
                                      ? 'bg-blue-500/20 border-blue-500/40'
                                      : 'bg-blue-50 border-blue-200'
                                    : isDarkMode
                                      ? 'bg-white/0 hover:bg-white/5 border-white/10'
                                      : 'bg-white hover:bg-gray-50 border-gray-200'
                                  } ${!isCurrentMonth ? (isDarkMode ? 'opacity-40' : 'opacity-50') : ''}`}
                              >
                                <div className={`text-xs ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{d.getDate()}</div>
                                {count > 0 && (
                                  <div className={`text-[10px] ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>{count} evt</div>
                                )}
                              </button>
                            );
                          });

                          return (
                            <div
                              className="grid grid-cols-7 gap-1 touch-none"
                              onTouchStart={handleDateTouchStart}
                              onTouchMove={handleDateTouchMove}
                              onTouchEnd={handleDateDragEnd}
                              onMouseUp={handleDateDragEnd}
                              onMouseLeave={handleDateDragEnd}
                            >
                              {cells}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="order-1 lg:order-3 lg:col-start-2">
                        <div className={`rounded-xl border p-3 ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-gray-50'}`}>
                          <div className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>Tasks</div>

                          {(() => {
                            const dayStart = new Date(selectedDate);
                            dayStart.setHours(0, 0, 0, 0);
                            const dayEnd = new Date(selectedDate);
                            dayEnd.setHours(23, 59, 59, 999);

                            const scheduledToday = tasks
                              .filter(t => typeof t.dueDate === 'number' && t.dueDate >= dayStart.getTime() && t.dueDate <= dayEnd.getTime())
                              .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

                            const unscheduled = tasks.filter(t => !t.dueDate && !t.googleCalendarEventId);
                            const list = [...scheduledToday, ...unscheduled].slice(0, 20);

                            if (!list.length) {
                              return <div className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>No tasks</div>;
                            }

                            return (
                              <div className="space-y-2 max-h-56 overflow-y-auto">
                                {list.map((task) => {
                                  const isScheduling = schedulingTaskId === task.id;
                                  const hasEvent = Boolean(task.googleCalendarEventId);
                                  const hasTime = Boolean(task.dueDate && task.dueDateEnd);
                                  return (
                                    <div key={task.id} className={`p-2 rounded-lg border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className={`text-xs font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{task.title}</div>
                                          {(hasEvent || hasTime) && (
                                            <div className={`text-[10px] mt-0.5 ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                                              {task.dueDate ? new Date(task.dueDate).toLocaleString() : 'Scheduled'}
                                            </div>
                                          )}
                                          {task.googleMeetLink && (
                                            <a
                                              href={task.googleMeetLink}
                                              target="_blank"
                                              rel="noreferrer"
                                              className={`text-[10px] ${isDarkMode ? 'text-blue-300 hover:text-blue-200' : 'text-blue-700 hover:text-blue-600'}`}
                                            >
                                              Join Meet
                                            </a>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-1">
                                          {task.googleCalendarHtmlLink && (
                                            <a
                                              href={task.googleCalendarHtmlLink}
                                              target="_blank"
                                              rel="noreferrer"
                                              className={`text-[10px] px-2 py-1 rounded ${isDarkMode ? 'bg-white/10 hover:bg-white/15 text-slate-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                                            >
                                              Event
                                            </a>
                                          )}
                                          {hasEvent ? (
                                            <button
                                              onClick={() => handleUnschedule(task)}
                                              disabled={calendarLoading}
                                              className={`text-[10px] px-2 py-1 rounded ${isDarkMode
                                                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300'
                                                : 'bg-red-50 hover:bg-red-100 text-red-700'
                                                } disabled:opacity-50`}
                                            >
                                              Unschedule
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() => handleStartScheduling(task)}
                                              disabled={calendarLoading}
                                              className={`text-[10px] px-2 py-1 rounded ${isDarkMode
                                                ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300'
                                                : 'bg-blue-50 hover:bg-blue-100 text-blue-700'
                                                } disabled:opacity-50`}
                                            >
                                              Schedule
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {isScheduling && (
                                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                                          <div>
                                            <div className={`text-[10px] mb-1 ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>Start</div>
                                            <input
                                              type="datetime-local"
                                              value={scheduleStartLocal}
                                              onChange={(e) => setScheduleStartLocal(e.target.value)}
                                              className={`w-full text-xs rounded-lg px-2 py-1 border outline-none ${isDarkMode
                                                ? 'bg-black/30 border-white/10 text-white'
                                                : 'bg-white border-gray-200 text-gray-900'
                                                }`}
                                            />
                                          </div>
                                          <div>
                                            <div className={`text-[10px] mb-1 ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>End</div>
                                            <input
                                              type="datetime-local"
                                              value={scheduleEndLocal}
                                              onChange={(e) => setScheduleEndLocal(e.target.value)}
                                              className={`w-full text-xs rounded-lg px-2 py-1 border outline-none ${isDarkMode
                                                ? 'bg-black/30 border-white/10 text-white'
                                                : 'bg-white border-gray-200 text-gray-900'
                                                }`}
                                            />

                                            <label className={`mt-2 flex items-center gap-2 text-[10px] ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                                              <input
                                                type="checkbox"
                                                checked={scheduleAddMeet}
                                                onChange={(e) => setScheduleAddMeet(e.target.checked)}
                                                className="accent-blue-600"
                                              />
                                              Add Google Meet
                                            </label>
                                          </div>
                                          <div className="flex gap-2">
                                            <button
                                              onClick={() => {
                                                setSchedulingTaskId(null);
                                              }}
                                              className={`flex-1 text-xs px-2 py-1 rounded-lg ${isDarkMode
                                                ? 'bg-white/10 hover:bg-white/15 text-slate-200'
                                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                                }`}
                                            >
                                              Cancel
                                            </button>
                                            <button
                                              onClick={() => handleConfirmSchedule(task)}
                                              disabled={calendarLoading}
                                              className="flex-1 text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
                                            >
                                              Save
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="order-3 lg:order-2 lg:col-start-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <button
                            onClick={async () => {
                              if (calendarLoading) return;
                              setCalendarLoading(true);
                              setCalendarError(null);
                              try {
                                await loadCalendarEvents(calendarMonth);
                              } catch (e: any) {
                                setCalendarError(e?.message || 'Failed to refresh calendar');
                              } finally {
                                setCalendarLoading(false);
                              }
                            }}
                            className={`text-xs px-2 py-1 rounded-lg ${isDarkMode ? 'bg-white/5 hover:bg-white/10 text-slate-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                          >
                            Refresh
                          </button>
                        </div>

                        <div className={`rounded-xl border p-3 mb-3 ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-gray-50'}`}>
                          <div className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>Calendar & Scheduled</div>
                          {selectedDayEvents.length === 0 ? (
                            <div className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>No events</div>
                          ) : (
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                              {selectedDayEvents.map((ev) => {
                                const isScheduledPost = ev?.isScheduledPost === true;
                                const title = String(ev?.summary || 'Untitled');
                                const htmlLink = typeof ev?.htmlLink === 'string' ? ev.htmlLink : '';
                                const hangoutLink = typeof ev?.hangoutLink === 'string' ? ev.hangoutLink : '';

                                if (isScheduledPost) {
                                  // Render scheduled post differently
                                  return (
                                    <div key={String(ev?.id || title)} className="flex items-start justify-between gap-2">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${ev?.status === 'scheduled' ? 'bg-blue-500/20 text-blue-400' :
                                          ev?.status === 'publishing' ? 'bg-yellow-500/20 text-yellow-400' :
                                            ev?.status === 'published' ? 'bg-green-500/20 text-green-400' :
                                              'bg-gray-500/20 text-gray-400'
                                          }`}>{ev?.status}</span>
                                        <div className="flex items-center gap-1 mx-1">
                                          {ev?.platforms?.map((p: string) => (
                                            <img
                                              key={p}
                                              src={PLATFORM_LOGOS[p] || ''}
                                              alt={p}
                                              className="w-3.5 h-3.5 object-contain"
                                              title={p}
                                            />
                                          ))}
                                        </div>
                                        <span className={`text-xs font-medium truncate ${isDarkMode ? 'text-purple-300' : 'text-purple-700'}`}>
                                          {ev?.textContent ? (ev.textContent.length > 30 ? ev.textContent.substring(0, 30) + '...' : ev.textContent) : 'Social Post'}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                }

                                // Render scheduled email differently
                                const isScheduledEmail = ev?.isScheduledEmail === true;
                                if (isScheduledEmail) {
                                  return (
                                    <div key={String(ev?.id || title)} className="flex items-start justify-between gap-2">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${ev?.status === 'scheduled' ? 'bg-purple-500/20 text-purple-400' :
                                          ev?.status === 'sending' ? 'bg-yellow-500/20 text-yellow-400' :
                                            ev?.status === 'sent' ? 'bg-green-500/20 text-green-400' :
                                              'bg-gray-500/20 text-gray-400'
                                          }`}>{ev?.status}</span>
                                        <span className="text-[10px]">{ev?.provider === 'gmail' ? '\ud83d\udce7' : '\ud83d\udce8'}</span>
                                        <span className={`text-xs font-medium truncate ${isDarkMode ? 'text-pink-300' : 'text-pink-700'}`}>
                                          {ev?.subject ? (ev.subject.length > 25 ? ev.subject.substring(0, 25) + '...' : ev.subject) : 'Email'}
                                          {ev?.recipientCount > 1 && ` (${ev.recipientCount})`}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div key={String(ev?.id || title)} className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className={`text-xs font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
                                      {hangoutLink && (
                                        <a
                                          href={hangoutLink}
                                          target="_blank"
                                          rel="noreferrer"
                                          className={`text-[10px] ${isDarkMode ? 'text-blue-300 hover:text-blue-200' : 'text-blue-700 hover:text-blue-600'}`}
                                        >
                                          Meet link
                                        </a>
                                      )}
                                    </div>
                                    {htmlLink && (
                                      <a
                                        href={htmlLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={`text-[10px] ${isDarkMode ? 'text-slate-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                                      >
                                        Open
                                      </a>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className={`rounded-xl border p-3 mb-3 ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-gray-50'}`}>
                          <div className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>Create event</div>
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={newEventTitle}
                              onChange={(e) => setNewEventTitle(e.target.value)}
                              placeholder="Event title"
                              className={`w-full text-sm rounded-lg px-3 py-2 border outline-none ${isDarkMode ? 'bg-black/30 border-white/10 text-white placeholder-slate-500' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                                }`}
                            />
                            <textarea
                              value={newEventDescription}
                              onChange={(e) => setNewEventDescription(e.target.value)}
                              placeholder="Description (optional)"
                              rows={2}
                              className={`w-full text-sm rounded-lg px-3 py-2 border outline-none resize-none ${isDarkMode ? 'bg-black/30 border-white/10 text-white placeholder-slate-500' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                                }`}
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <div className={`text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>Start</div>
                                <input
                                  type="datetime-local"
                                  value={newEventStartLocal}
                                  onChange={(e) => setNewEventStartLocal(e.target.value)}
                                  className={`w-full text-sm rounded-lg px-2 py-2 border outline-none ${isDarkMode ? 'bg-black/30 border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900'
                                    }`}
                                />
                              </div>
                              <div>
                                <div className={`text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>End</div>
                                <input
                                  type="datetime-local"
                                  value={newEventEndLocal}
                                  onChange={(e) => setNewEventEndLocal(e.target.value)}
                                  className={`w-full text-sm rounded-lg px-2 py-2 border outline-none ${isDarkMode ? 'bg-black/30 border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900'
                                    }`}
                                />
                              </div>
                            </div>
                            <label className={`flex items-center gap-2 text-xs ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                              <input
                                type="checkbox"
                                checked={newEventAddMeet}
                                onChange={(e) => setNewEventAddMeet(e.target.checked)}
                                className="accent-blue-600 w-4 h-4"
                              />
                              Add Google Meet
                            </label>
                            <button
                              onClick={handleCreateCalendarEvent}
                              disabled={calendarLoading}
                              className="w-full text-sm font-medium px-4 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 mt-2"
                            >
                              Add event to this date
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {calendarLoading && (
                    <div className={`mt-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>Loading…</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {editingTask && (
        <TaskDetailModal
          task={editingTask}
          isOpen={true}
          onClose={() => setEditingTask(null)}
          onUpdate={handleUpdateTask}
          onDelete={handleDeleteTask}
          isDarkMode={isDarkMode}
          readOnly={isReadOnly}
        />
      )}

    </>
  );
};


