import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Edge,
  Node,
  Position,
  Handle,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentAssignment, AgentLog, SwarmSession, TaskPlanStep } from '../types';
import {
  subscribeToActiveAssignments,
  subscribeToAssignmentLogs,
  subscribeToAllSessions,
  pingSwarmWorker,
  cancelAgentAssignment,
} from '../services/agentSwarmService';
import { db } from '../services/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';

export interface SwarmCanvasProps {
  adminId: string;
}

// ─── Custom Node: Agent with Task Plan Progress ──────────────────────

const AgentNode = ({ data }: { data: any }) => {
  const isRunning = data.status === 'running' || data.status === 'planning' || data.status === 'pending';
  const isComplete = data.status === 'completed';
  const isFailed = data.status === 'failed';

  const taskPlan: TaskPlanStep[] = data.taskPlan || [];
  const doneSteps = taskPlan.filter(s => s.status === 'done').length;
  const totalSteps = taskPlan.length;
  const progress = totalSteps > 0 ? (doneSteps / totalSteps) * 100 : 0;

  return (
    <div className={`px-4 py-3 rounded-lg shadow-xl border-2 bg-gray-900 min-w-[220px] max-w-[280px]
      ${isRunning ? 'border-emerald-500 shadow-emerald-500/20' :
        isComplete ? 'border-blue-500 shadow-blue-500/10' :
          isFailed ? 'border-red-500 shadow-red-500/10' : 'border-gray-600'}`}>

      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-gray-400" />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isRunning ? 'bg-emerald-500 animate-pulse' :
          isComplete ? 'bg-blue-500' :
            isFailed ? 'bg-red-500' : 'bg-gray-500'
          }`} />
        <div className="text-sm font-bold text-gray-100 truncate flex-1">Sub-Agent</div>

        {isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); cancelAgentAssignment(data.id); }}
            className="hover:bg-red-500/20 hover:text-red-400 text-gray-500 p-1 rounded transition-colors mr-1"
            title="Cancel Agent"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        <div className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium
          ${isRunning ? 'bg-emerald-500/20 text-emerald-300' :
            isComplete ? 'bg-blue-500/20 text-blue-300' :
              isFailed ? 'bg-red-500/20 text-red-300' : 'bg-gray-700 text-gray-400'}`}>
          {data.status}
        </div>
      </div>

      {/* Goal */}
      <div className="text-xs text-gray-300 italic mb-2 line-clamp-2" title={data.goal}>
        "{data.goal}"
      </div>

      {/* Task Plan Progress */}
      {totalSteps > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
            <span>Plan: {doneSteps}/{totalSteps} steps</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isComplete ? 'bg-blue-500' : isFailed ? 'bg-red-500' : 'bg-emerald-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {isRunning && data.currentStep < totalSteps && (
            <div className="mt-1 text-[10px] text-emerald-300 font-mono truncate">
              ▸ {taskPlan[data.currentStep]?.action}
            </div>
          )}
        </div>
      )}

      {/* Latest Log */}
      {data.latestLog && (
        <div className="mt-2 pt-2 border-t border-gray-700 bg-gray-800/50 p-1.5 rounded text-[10px] text-gray-400 font-mono truncate">
          {'> '}{data.latestLog.message}
        </div>
      )}

      {/* Artifacts */}
      {isComplete && data.artifacts && data.artifacts.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          {data.artifacts.slice(0, 4).map((a: any, i: number) => (
            <span key={i} className="text-[10px] bg-blue-500/20 text-blue-300 px-1 py-0.5 rounded">
              {a.type}
            </span>
          ))}
          {data.artifacts.length > 4 && (
            <span className="text-[10px] text-gray-500">+{data.artifacts.length - 4}</span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-gray-400" />
    </div>
  );
};

// ─── Custom Node: Project Target ─────────────────────────────────────

const ProjectTargetNode = ({ data }: { data: any }) => {
  return (
    <div className="px-4 py-3 rounded-lg shadow-xl border-2 border-indigo-500 bg-gray-900 min-w-[150px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 !bg-indigo-500" />
      <div className="text-sm font-bold text-indigo-400 mb-1">Target Project</div>
      <div className="text-xs text-gray-300 font-mono">{data.projectId.substring(0, 12)}...</div>
      <div className="text-xs text-gray-500">User: {data.userId.substring(0, 12)}...</div>
    </div>
  );
};

// ─── Custom Node: Project Context (AI-created) ───────────────────────

const ProjectContextNode = ({ data }: { data: any }) => (
  <div className="rounded-xl border-2 border-violet-500 bg-gray-900/95 shadow-lg shadow-violet-500/10 min-w-[220px] max-w-[280px] overflow-hidden">
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-violet-500" />
    <div className="bg-gradient-to-r from-violet-600/30 to-purple-600/20 px-3 py-2 flex items-center gap-2">
      <span className="text-base">📁</span>
      <span className="text-xs font-bold text-violet-300 uppercase tracking-wide">Project Context</span>
    </div>
    <div className="p-3 space-y-1">
      <div className="text-sm font-semibold text-white">{data.data?.name || data.label}</div>
      {data.data?.description && (
        <div className="text-[11px] text-gray-400 line-clamp-2">{data.data.description}</div>
      )}
      {data.data?.taskCount !== undefined && (
        <div className="text-[10px] text-violet-400 mt-1">{data.data.taskCount} tasks · {data.data?.sessionCount || 0} sessions</div>
      )}
    </div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-violet-500" />
  </div>
);

// ─── Custom Node: User ───────────────────────────────────────────────

const UserContextNode = ({ data }: { data: any }) => (
  <div className="rounded-xl border-2 border-sky-500 bg-gray-900/95 shadow-lg shadow-sky-500/10 min-w-[200px]">
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-sky-500" />
    <div className="bg-gradient-to-r from-sky-600/30 to-blue-600/20 px-3 py-2 flex items-center gap-2">
      <span className="text-base">👤</span>
      <span className="text-xs font-bold text-sky-300 uppercase tracking-wide">User</span>
    </div>
    <div className="p-3">
      <div className="text-sm font-semibold text-white">{data.data?.displayName || data.data?.email || data.label}</div>
      {data.data?.email && data.data?.displayName && (
        <div className="text-[11px] text-gray-400">{data.data.email}</div>
      )}
      {data.data?.uid && (
        <div className="text-[10px] text-sky-400 font-mono mt-1">{data.data.uid.substring(0, 16)}...</div>
      )}
    </div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-sky-500" />
  </div>
);

// ─── Custom Node: Task ───────────────────────────────────────────────

const TaskContextNode = ({ data }: { data: any }) => {
  const statusColor = data.data?.status === 'done' ? 'text-emerald-300 bg-emerald-500/20'
    : data.data?.status === 'in_progress' ? 'text-amber-300 bg-amber-500/20'
      : 'text-gray-400 bg-gray-700';
  return (
    <div className="rounded-xl border-2 border-cyan-500 bg-gray-900/95 shadow-lg shadow-cyan-500/10 min-w-[200px]">
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-cyan-500" />
      <div className="bg-gradient-to-r from-cyan-600/30 to-teal-600/20 px-3 py-2 flex items-center gap-2">
        <span className="text-base">✅</span>
        <span className="text-xs font-bold text-cyan-300 uppercase tracking-wide">Task</span>
      </div>
      <div className="p-3 space-y-1">
        <div className="text-sm font-semibold text-white line-clamp-2">{data.data?.title || data.label}</div>
        {data.data?.status && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor}`}>{data.data.status}</span>
        )}
        {data.data?.description && (
          <div className="text-[11px] text-gray-400 line-clamp-2 mt-1">{data.data.description}</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-cyan-500" />
    </div>
  );
};

// ─── Custom Node: Action (AI workflow node) ──────────────────────────

const ACTION_META: Record<string, { icon: string; color: string; label: string }> = {
  generate_image: { icon: '🎨', color: '#ec4899', label: 'Generate Image' },
  generate_blog: { icon: '📝', color: '#f59e0b', label: 'Generate Blog' },
  generate_project_website: { icon: '🌐', color: '#10b981', label: 'Generate Website' },
  generate_canvas_website: { icon: '🚀', color: '#8b5cf6', label: 'Deploy Canvas App' },
  generate_video_clip: { icon: '🎬', color: '#ef4444', label: 'Generate Video' },
  generate_video_overview: { icon: '🌍', color: '#f59e0b', label: 'Video Overview' },
  generate_video_ad: { icon: '📢', color: '#a855f7', label: 'Product Ad Video' },
  generate_podcast: { icon: '🎙️', color: '#6366f1', label: 'Generate Podcast' },
  generate_pdf: { icon: '📄', color: '#64748b', label: 'Generate PDF' },
  generate_table: { icon: '📊', color: '#0ea5e9', label: 'Generate Table' },
  generate_form: { icon: '📋', color: '#10b981', label: 'Generate Form' },
  generate_email: { icon: '✉️', color: '#f97316', label: 'Generate Email' },
};

const ActionNode = ({ data }: { data: any }) => {
  const meta = ACTION_META[data.subtype] || { icon: '⚡', color: '#6366f1', label: data.subtype || 'Action' };
  const isRunning = data.status === 'running';
  const isDone = data.status === 'done';
  const isError = data.status === 'error';
  const isIdle = data.status === 'idle' || !data.status;

  const borderColor = isRunning ? '#10b981' : isDone ? meta.color : isError ? '#ef4444' : '#374151';

  return (
    <div
      className="rounded-xl bg-gray-900/95 shadow-xl min-w-[230px] max-w-[290px] overflow-hidden"
      style={{ border: `2px solid ${borderColor}`, boxShadow: `0 0 24px ${borderColor}22` }}
    >
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-gray-500" />

      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2" style={{ background: `${meta.color}22` }}>
        <span className="text-lg">{meta.icon}</span>
        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</div>
        </div>
        {/* Status pill */}
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${isRunning ? 'bg-emerald-500/20 text-emerald-300 animate-pulse' :
            isDone ? 'bg-blue-500/20 text-blue-300' :
              isError ? 'bg-red-500/20 text-red-300' :
                'bg-gray-700 text-gray-500'
          }`}>
          {isRunning ? '● running' : isDone ? '✓ done' : isError ? '✗ error' : '○ idle'}
        </span>
      </div>

      {/* Prompt preview */}
      {data.data?.prompt && (
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="text-[10px] text-gray-500 mb-0.5">Prompt</div>
          <div className="text-[11px] text-gray-300 italic line-clamp-2">"{data.data.prompt}"</div>
        </div>
      )}

      {/* Enriched prompt */}
      {data.enrichedPrompt && data.enrichedPrompt !== data.data?.prompt && (
        <div className="px-3 py-2 border-b border-gray-800 bg-gray-800/30">
          <div className="text-[10px] text-emerald-500 mb-0.5">✨ Enriched by AI</div>
          <div className="text-[11px] text-emerald-200/70 italic line-clamp-2">"{data.enrichedPrompt}"</div>
        </div>
      )}

      {/* Result */}
      {isDone && data.result && (
        <div className="px-3 py-2 bg-gray-800/50">
          {data.result?.url && <img src={data.result.url} alt="result" className="w-full h-28 object-cover rounded-md mb-1" />}
          {data.result?.blog && (
            <div className="text-[10px] text-gray-300 font-mono line-clamp-4 whitespace-pre-wrap">{data.result.blog.slice(0, 240)}...</div>
          )}
          {data.result?.assetId && !data.result?.url && (
            <div className="text-[11px] text-emerald-300">✓ Saved to project (id: {data.result.assetId})</div>
          )}
          {data.result?.previewUrl && (
            <a href={data.result.previewUrl} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 underline">
              🔗 View deployment →
            </a>
          )}
        </div>
      )}

      {isError && data.result?.error && (
        <div className="px-3 py-2 bg-red-950/50 text-[11px] text-red-300">{data.result.error}</div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-gray-500" />
    </div>
  );
};

// ─── Node Type Registry ───────────────────────────────────────────────

const nodeTypes = {
  agentNode: AgentNode,
  projectNode: ProjectTargetNode,
  projectContextNode: ProjectContextNode,
  userContextNode: UserContextNode,
  taskContextNode: TaskContextNode,
  actionNode: ActionNode,
};

// ─── Main Canvas Component ────────────────────────────────────────────

export const SwarmCanvas: React.FC<SwarmCanvasProps> = ({ adminId }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [assignments, setAssignments] = useState<AgentAssignment[]>([]);
  const [logsMap, setLogsMap] = useState<Record<string, AgentLog[]>>({});
  const [sessions, setSessions] = useState<SwarmSession[]>([]);
  const [canvasNodes, setCanvasNodes] = useState<any[]>([]);
  const [showSharedContext, setShowSharedContext] = useState(false);

  // Subscribe to sessions
  useEffect(() => {
    const unsub = subscribeToAllSessions(setSessions);
    return () => unsub();
  }, []);

  // Subscribe to agent assignments
  useEffect(() => {
    const unsub = subscribeToActiveAssignments((data) => {
      const recent = data.filter(d =>
        d.status === 'running' ||
        d.status === 'pending' ||
        d.status === 'planning' ||
        (Date.now() - d.updatedAt < 1000 * 60 * 60)
      );
      setAssignments(recent);
    });
    return () => unsub();
  }, []);

  // Subscribe to AI-created canvas_nodes collection
  useEffect(() => {
    const q = query(collection(db, 'canvas_nodes'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setCanvasNodes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Ping worker to keep Vercel function alive for active assignments
  useEffect(() => {
    const hasActive = assignments.some(a =>
      a.status === 'pending' || a.status === 'planning' || a.status === 'running'
    );
    if (!hasActive) return;
    pingSwarmWorker();
    const interval = setInterval(() => { pingSwarmWorker(); }, 5000);
    return () => clearInterval(interval);
  }, [assignments]);

  // Subscribe to logs for active assignments
  useEffect(() => {
    const unsubs: any[] = [];
    assignments.forEach(a => {
      if (!logsMap[a.id]) {
        const unsub = subscribeToAssignmentLogs(a.id, (logs) => {
          setLogsMap(prev => ({ ...prev, [a.id]: logs }));
        });
        unsubs.push(unsub);
      }
    });
    return () => { unsubs.forEach(fn => fn()); };
  }, [assignments]);

  // Build the full graph from agent assignments + AI canvas nodes
  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // ── Orchestrator Node ─────────────────────────────────────────────
    newNodes.push({
      id: 'orchestrator',
      type: 'default',
      position: { x: 400, y: 50 },
      data: { label: '👑 Swarm Director' },
      style: {
        background: 'linear-gradient(135deg, #1f2937, #312e81)',
        color: 'white',
        border: '2px solid #a855f7',
        fontWeight: 'bold',
        borderRadius: '12px',
        padding: '12px 20px',
        fontSize: '14px',
      }
    });

    // ── Agent Assignment Nodes ────────────────────────────────────────
    const projectNodesSet = new Set<string>();
    assignments.forEach((assignment, index) => {
      const logs = logsMap[assignment.id] || [];
      const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
      const artifacts = logs.flatMap(l => l.artifactsCreated || []);
      const agentNodeId = `agent-${assignment.id}`;
      const projectNodeId = `project-${assignment.targetProjectId}`;

      newNodes.push({
        id: agentNodeId,
        type: 'agentNode',
        position: { x: (index * 300) + 100, y: 220 },
        data: { ...assignment, latestLog, artifacts },
      });

      newEdges.push({
        id: `orch-${agentNodeId}`,
        source: 'orchestrator',
        target: agentNodeId,
        animated: assignment.status === 'pending' || assignment.status === 'running' || assignment.status === 'planning',
        style: { stroke: '#a855f7', strokeWidth: 2 },
      });

      if (!projectNodesSet.has(projectNodeId)) {
        projectNodesSet.add(projectNodeId);
        newNodes.push({
          id: projectNodeId,
          type: 'projectNode',
          position: { x: (index * 300) + 100, y: 470 },
          data: { projectId: assignment.targetProjectId, userId: assignment.targetUserId }
        });
      }

      const edgeColor = assignment.status === 'running' ? '#10b981' :
        assignment.status === 'completed' ? '#3b82f6' :
          assignment.status === 'failed' ? '#ef4444' : '#6366f1';

      newEdges.push({
        id: `${agentNodeId}-${projectNodeId}`,
        source: agentNodeId,
        target: projectNodeId,
        animated: assignment.status === 'running' || assignment.status === 'planning',
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
        style: { stroke: edgeColor, strokeWidth: 2 },
      });
    });

    // ── AI-Created Canvas Nodes ───────────────────────────────────────
    const nodeTypeMap: Record<string, string> = {
      project: 'projectContextNode',
      user: 'userContextNode',
      task: 'taskContextNode',
      action: 'actionNode',
    };

    canvasNodes.forEach((cn) => {
      const resolvedType = nodeTypeMap[cn.type] || 'default';
      newNodes.push({
        id: cn.id,
        type: resolvedType,
        position: cn.position || { x: 300, y: 300 },
        data: { ...cn, subtype: cn.subtype },
      });

      // Draw edges from this node to its targets
      (cn.edges || []).forEach((targetId: string) => {
        const edgeId = `canvas-${cn.id}-${targetId}`;
        const isRunningEdge = cn.status === 'running';
        newEdges.push({
          id: edgeId,
          source: cn.id,
          target: targetId,
          animated: isRunningEdge,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#a855f7' },
          style: { stroke: '#a855f7', strokeWidth: 1.5, strokeDasharray: '4 2' },
        });
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [assignments, logsMap, canvasNodes, setNodes, setEdges]);

  // Active shared context
  const activeSharedContext = useMemo(() => {
    const active = sessions.find(s => s.status === 'active');
    return active?.sharedContext || '';
  }, [sessions]);

  const activeCount = assignments.filter(a => a.status === 'running' || a.status === 'planning').length;
  const doneCount = assignments.filter(a => a.status === 'completed').length;
  const canvasNodeCount = canvasNodes.length;
  const runningCanvasCount = canvasNodes.filter(n => n.status === 'running').length;
  const doneCanvasCount = canvasNodes.filter(n => n.status === 'done').length;

  return (
    <div className="w-full h-full bg-gray-950 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        className="bg-gray-950"
      >
        <Controls className="!bg-gray-800 !border-gray-700 !text-white" />
        <MiniMap
          nodeStrokeColor={(n) => {
            if (n.type === 'agentNode') return '#10b981';
            if (n.type === 'projectNode') return '#6366f1';
            if (n.type === 'projectContextNode') return '#8b5cf6';
            if (n.type === 'userContextNode') return '#0ea5e9';
            if (n.type === 'taskContextNode') return '#06b6d4';
            if (n.type === 'actionNode') return '#ec4899';
            return '#a855f7';
          }}
          nodeColor={() => '#1f2937'}
          maskColor="rgba(0, 0, 0, 0.7)"
          className="!bg-gray-900"
        />
        <Background color="#374151" gap={16} />
      </ReactFlow>

      {/* Shared Context Panel */}
      <div className="absolute bottom-4 left-4 z-20">
        <button
          onClick={() => setShowSharedContext(!showSharedContext)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border
            ${showSharedContext
              ? 'bg-indigo-600 text-white border-indigo-500'
              : 'bg-gray-800/90 text-gray-300 border-gray-700 hover:bg-gray-700'
            }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Swarm Mind
          {activeSharedContext && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>

        {showSharedContext && (
          <div className="mt-2 w-[400px] max-h-[300px] bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
              <span className="text-xs font-medium text-indigo-400">Shared Swarm Context</span>
              <span className="text-[10px] text-gray-500">Inter-agent awareness</span>
            </div>
            <div className="p-3 overflow-y-auto max-h-[250px]">
              {activeSharedContext ? (
                <pre className="text-[11px] text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
                  {activeSharedContext}
                </pre>
              ) : (
                <div className="text-xs text-gray-500 text-center py-4">
                  No active swarm context. Agents will populate this as they work.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Stats Bar */}
      <div className="absolute top-4 right-4 z-20 flex gap-2 flex-wrap justify-end">
        <div className="bg-gray-800/90 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="text-[10px] text-gray-400 uppercase">Agents</span>
          <span className="text-sm font-bold text-white">{assignments.length}</span>
        </div>
        <div className="bg-gray-800/90 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="text-[10px] text-gray-400 uppercase">Running</span>
          <span className="text-sm font-bold text-emerald-400">{activeCount}</span>
        </div>
        <div className="bg-gray-800/90 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="text-[10px] text-gray-400 uppercase">Done</span>
          <span className="text-sm font-bold text-blue-400">{doneCount}</span>
        </div>
        {canvasNodeCount > 0 && (
          <>
            <div className="bg-gray-800/90 border border-violet-700/50 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="text-[10px] text-violet-400 uppercase">Workflow</span>
              <span className="text-sm font-bold text-violet-300">{canvasNodeCount}</span>
            </div>
            {runningCanvasCount > 0 && (
              <div className="bg-emerald-900/50 border border-emerald-700/50 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-emerald-400 uppercase">Active</span>
                <span className="text-sm font-bold text-emerald-300">{runningCanvasCount}</span>
              </div>
            )}
            {doneCanvasCount > 0 && (
              <div className="bg-gray-800/90 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="text-[10px] text-gray-400 uppercase">Completed</span>
                <span className="text-sm font-bold text-emerald-400">{doneCanvasCount}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
