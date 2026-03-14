/**
 * MarketingAgentPanel.tsx
 * 
 * Campaign Command Center — autonomous marketing agent UI panel
 * Embedded inside HomeLiveAssistant.tsx when marketing mode is active.
 */

import React, { useState } from 'react';
import {
  MarketingSession,
  MarketingPhase,
  ContentPiece,
  ScheduleItem,
  MarketingScheduledPost,
} from '../types';

// ─── Phase Meta ───────────────────────────────────────────────────────────────

const PHASE_META: Record<MarketingPhase, { icon: string; label: string; color: string }> = {
  idle:       { icon: '🎯', label: 'Ready',        color: '#64748b' },
  briefing:   { icon: '📋', label: 'Briefing',     color: '#f59e0b' },
  researching:{ icon: '🔍', label: 'Researching',  color: '#3b82f6' },
  planning:   { icon: '🗺️', label: 'Planning',     color: '#8b5cf6' },
  generating: { icon: '✨', label: 'Generating',   color: '#ec4899' },
  publishing: { icon: '🚀', label: 'Publishing',   color: '#10b981' },
  complete:   { icon: '✅', label: 'Complete',     color: '#22c55e' },
};

const PLATFORM_META: Record<string, { icon: string; color: string; bg: string }> = {
  instagram: { icon: '📸', color: '#e1306c', bg: 'rgba(225,48,108,0.1)' },
  tiktok:    { icon: '🎵', color: '#69c9d0', bg: 'rgba(105,201,208,0.1)' },
  facebook:  { icon: '📘', color: '#1877f2', bg: 'rgba(24,119,242,0.1)' },
  linkedin:  { icon: '💼', color: '#0a66c2', bg: 'rgba(10,102,194,0.1)' },
  youtube:   { icon: '▶️', color: '#ff0000', bg: 'rgba(255,0,0,0.1)' },
  x:         { icon: '𝕏',  color: '#ffffff', bg: 'rgba(255,255,255,0.08)' },
};

const CONTENT_TYPE_ICON: Record<string, string> = {
  image:    '🖼️',
  video:    '🎬',
  reel:     '📱',
  carousel: '🎠',
  text:     '📝',
  story:    '⭕',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface MarketingAgentPanelProps {
  session: MarketingSession;
  isDarkMode: boolean;
  isProcessing?: boolean;
  onEditAsset: (assetId: string, instruction: string) => void;
  onRegenerateAsset: (contentPieceId: string) => void;
  onRetryAsset?: (contentPieceId: string) => void;
  onApproveAsset?: (contentPieceId: string) => void;
  onEditCaption?: (contentPieceId: string, newCaption: string) => void;
  onReschedulePost: (postId: string, newTime: number) => void;
  onPublishPost?: (post: MarketingScheduledPost) => Promise<void>;
  onClearSession?: () => void;
  onUpdateContentPiece?: (pieceId: string, updates: Partial<ContentPiece>) => void;
  onViewCalendar?: () => void;
}

// ─── Sub-Components ───────────────────────────────────────────────────────────

const PhaseBar: React.FC<{ phase: MarketingPhase; isDarkMode: boolean }> = ({ phase, isDarkMode }) => {
  const phases: MarketingPhase[] = ['briefing', 'researching', 'planning', 'generating', 'publishing', 'complete'];
  const currentIdx = phases.indexOf(phase);

  return (
    <div style={{ padding: '10px 14px', borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'space-between' }}>
        {phases.map((p, i) => {
          const meta = PHASE_META[p];
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <React.Fragment key={p}>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                opacity: (done || active) ? 1 : 0.35,
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? meta.color : done ? 'rgba(34,197,94,0.2)' : (isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'),
                  border: active ? `2px solid ${meta.color}` : done ? '2px solid rgba(34,197,94,0.5)' : '2px solid transparent',
                  fontSize: 12,
                  boxShadow: active ? `0 0 10px ${meta.color}55` : 'none',
                  transition: 'all 0.3s',
                }}>
                  {done ? '✓' : meta.icon}
                </div>
                <span style={{ fontSize: 8.5, fontWeight: active ? 700 : 500, color: active ? meta.color : (isDarkMode ? '#94a3b8' : '#64748b'), textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {meta.label}
                </span>
              </div>
              {i < phases.length - 1 && (
                <div style={{
                  flex: 1, height: 2, background: done ? 'rgba(34,197,94,0.5)' : (isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'),
                  borderRadius: 1, marginBottom: 14, transition: 'background 0.5s',
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const ResearchCard: React.FC<{ icon: string; label: string; value: string | number; isDarkMode: boolean }> = ({ icon, label, value, isDarkMode }) => (
  <div style={{
    padding: '8px 10px', borderRadius: 8,
    background: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
    display: 'flex', alignItems: 'center', gap: 8,
  }}>
    <span style={{ fontSize: 16 }}>{icon}</span>
    <div>
      <div style={{ fontSize: 10, color: isDarkMode ? '#64748b' : '#9ca3af', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#111827' }}>{value}</div>
    </div>
  </div>
);

const ContentPieceCard: React.FC<{
  piece: ContentPiece;
  isDarkMode: boolean;
  onEdit: (instruction: string) => void;
  onRegenerate: () => void;
  onRetry?: () => void;
  onApprove?: () => void;
  onEditCaption?: (newCaption: string) => void;
}> = ({ piece, isDarkMode, onEdit, onRegenerate, onRetry, onApprove, onEditCaption }) => {
  const [captionEditMode, setCaptionEditMode] = useState(false);
  const [editedCaption, setEditedCaption] = useState(piece.caption);
  const [editMode, setEditMode] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const platformMeta = PLATFORM_META[piece.platform] || { icon: '📱', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' };
  const typeIcon = CONTENT_TYPE_ICON[piece.type] || '📄';

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
      background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    }}>
      {/* Asset Preview */}
      {piece.assetUrl && (
        <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: isDarkMode ? '#0d0d1a' : '#f1f5f9' }}>
          <img
            src={piece.assetUrl}
            alt="Generated asset"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }}>
            <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: platformMeta.bg, color: platformMeta.color, backdropFilter: 'blur(8px)' }}>
              {platformMeta.icon} {piece.platform}
            </span>
            <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(8px)' }}>
              {typeIcon} {piece.type}
            </span>
          </div>
        </div>
      )}

      {/* No asset yet — placeholder or generating/error state */}
      {!piece.assetUrl && (
        <div style={{
          padding: '24px', textAlign: 'center', 
          borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
          background: piece.status === 'error' ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
        }}>
          {piece.status === 'generating' || piece.isGenerating ? (
            <div style={{ animation: 'pulse 1.5s infinite alternate opacity' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6366f1' }}>Generating…</div>
              {piece.generationAttempts && piece.generationAttempts > 1 && (
                <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 4 }}>Attempt {piece.generationAttempts}/3</div>
              )}
            </div>
          ) : piece.status === 'error' ? (
            <div>
               <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
               <div style={{ fontSize: 11, fontWeight: 600, color: '#ef4444' }}>Generation Failed</div>
               <div style={{ fontSize: 10, color: '#ef4444', opacity: 0.8, marginTop: 4, marginBottom: 12 }}>{piece.errorMessage}</div>
               {onRetry && (
                 <button onClick={onRetry} style={{ padding: '6px 12px', borderRadius: 6, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Try Again</button>
               )}
            </div>
          ) : (
            <div style={{ opacity: 0.5 }}>
              <span style={{ fontSize: 28 }}>{typeIcon}</span>
              <div style={{ fontSize: 11, marginTop: 4, color: isDarkMode ? '#64748b' : '#9ca3af' }}>Pending generation</div>
            </div>
          )}
        </div>
      )}

      {/* Caption + Hashtags */}
      <div style={{ padding: '10px 12px' }}>
        {captionEditMode ? (
          <div style={{ marginBottom: 6 }}>
            <textarea 
              value={editedCaption}
              onChange={e => setEditedCaption(e.target.value)}
              style={{ width: '100%', minHeight: 60, padding: 6, fontSize: 12, borderRadius: 6, border: `1px solid ${isDarkMode ? 'rgba(99,102,241,0.4)' : 'rgba(99,102,241,0.3)'}`, background: isDarkMode ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)', color: isDarkMode ? '#e2e8f0' : '#111827', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button onClick={() => { if(onEditCaption) onEditCaption(editedCaption); setCaptionEditMode(false); }} style={{ flex: 1, padding: 4, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Save Capt.</button>
              <button onClick={() => setCaptionEditMode(false)} style={{ flex: 1, padding: 4, background: 'transparent', border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, color: isDarkMode ? '#94a3b8' : '#6b7280', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <p 
            onClick={() => setCaptionEditMode(true)}
            style={{ fontSize: 12, lineHeight: 1.5, color: isDarkMode ? '#cbd5e1' : '#374151', margin: '0 0 6px', WebkitLineClamp: 3, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', cursor: 'pointer' }}
            title="Click to edit caption"
          >
            {piece.caption}
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {piece.hashtags.slice(0, 5).map(h => (
            <span key={h} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: isDarkMode ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)', color: '#6366f1', fontWeight: 500 }}>{h}</span>
          ))}
          {piece.hashtags.length > 5 && <span style={{ fontSize: 10, color: isDarkMode ? '#64748b' : '#9ca3af' }}>+{piece.hashtags.length - 5} more</span>}
        </div>
      </div>

      {/* Edit bar */}
      {!editMode ? (
        <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderTop: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
          <button onClick={() => setEditMode(true)} disabled={piece.status === 'generating' || piece.isGenerating} style={{
            flex: 1, padding: '5px 8px', borderRadius: 6, border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            background: 'transparent', color: isDarkMode ? '#94a3b8' : '#6b7280', cursor: 'pointer', fontSize: 11, fontWeight: 500,
            opacity: (piece.status === 'generating' || piece.isGenerating) ? 0.5 : 1
          }}>✏️ Edit</button>
          <button onClick={onRegenerate} disabled={piece.status === 'generating' || piece.isGenerating} style={{
            flex: 1, padding: '5px 8px', borderRadius: 6, border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            background: 'transparent', color: isDarkMode ? '#94a3b8' : '#6b7280', cursor: 'pointer', fontSize: 11, fontWeight: 500,
            opacity: (piece.status === 'generating' || piece.isGenerating) ? 0.5 : 1
          }}>🔄 Redo</button>
          {onApprove && piece.status !== 'ready' && piece.status !== 'error' && (
            <button onClick={onApprove} disabled={piece.status === 'generating' || piece.isGenerating} style={{
              flex: 1, padding: '5px 8px', borderRadius: 6, border: `1px solid rgba(34,197,94,0.3)`,
              background: 'rgba(34,197,94,0.1)', color: '#22c55e', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              opacity: (piece.status === 'generating' || piece.isGenerating) ? 0.5 : 1
            }}>✅ Approve</button>
          )}
        </div>
      ) : (
        <div style={{ padding: '8px 10px', borderTop: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
          <input
            autoFocus
            value={editInstruction}
            onChange={e => setEditInstruction(e.target.value)}
            placeholder="Describe the change…"
            style={{
              width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${isDarkMode ? 'rgba(99,102,241,0.4)' : 'rgba(99,102,241,0.3)'}`,
              background: isDarkMode ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)', color: isDarkMode ? '#e2e8f0' : '#111827',
              fontSize: 12, outline: 'none', boxSizing: 'border-box',
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && editInstruction.trim()) { onEdit(editInstruction); setEditMode(false); setEditInstruction(''); }
              if (e.key === 'Escape') setEditMode(false);
            }}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button onClick={() => { if (editInstruction.trim()) { onEdit(editInstruction); setEditMode(false); setEditInstruction(''); } }}
              style={{ flex: 1, padding: '4px', borderRadius: 5, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Apply</button>
            <button onClick={() => setEditMode(false)}
              style={{ flex: 1, padding: '4px', borderRadius: 5, border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, background: 'transparent', color: isDarkMode ? '#94a3b8' : '#6b7280', cursor: 'pointer', fontSize: 11 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

const ScheduledPostRow: React.FC<{
  post: MarketingScheduledPost;
  isDarkMode: boolean;
  onReschedule: (newTime: number) => void;
  onPublish?: () => Promise<void>;
  isProcessing?: boolean;
}> = ({ post, isDarkMode, onReschedule, onPublish, isProcessing }) => {
  const platformMeta = PLATFORM_META[post.platform] || { icon: '📱', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' };
  const scheduledDate = new Date(post.scheduledAt);
  const statusColors: Record<string, string> = {
    scheduled: '#f59e0b',
    posted: '#22c55e',
    published: '#22c55e',
    failed: '#ef4444',
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      borderRadius: 8, background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    }}>
      <span style={{ fontSize: 16 }}>{platformMeta.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {post.caption.substring(0, 60)}{post.caption.length > 60 ? '…' : ''}
        </div>
        <div style={{ fontSize: 10, color: isDarkMode ? '#64748b' : '#9ca3af', marginTop: 1 }}>
          {scheduledDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {scheduledDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </div>
      </div>

      {post.status === 'scheduled' && onPublish && (
        <button
          onClick={onPublish}
          disabled={isProcessing}
          style={{
            fontSize: 9, fontWeight: 700, padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
            background: '#22c55e', color: '#fff', border: 'none', opacity: isProcessing ? 0.5 : 1
          }}
        >
          {isProcessing ? '...' : 'PUBLISH NOW'}
        </button>
      )}

      <span style={{
        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5,
        background: `${statusColors[post.status] || '#64748b'}22`,
        color: statusColors[post.status] || '#64748b',
      }}>{post.status}</span>
    </div>
  );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────

export const MarketingAgentPanel: React.FC<MarketingAgentPanelProps> = ({
  session,
  isDarkMode,
  isProcessing,
  onEditAsset,
  onRegenerateAsset,
  onReschedulePost,
  onPublishPost,
  onClearSession,
  onRetryAsset,
  onApproveAsset,
  onEditCaption,
}) => {
  const [activeTab, setActiveTab] = useState<'research' | 'plan' | 'assets' | 'schedule'>('research');
  const bg = isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const border = isDarkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const textPrimary = isDarkMode ? '#e2e8f0' : '#111827';
  const textSecondary = isDarkMode ? '#64748b' : '#9ca3af';

  const research = session.researchResults;
  const plan = session.campaignPlan;
  const assets = session.generatedAssets || [];
  const scheduled = session.scheduledPosts || [];

  const tabs = [
    { id: 'research', label: '🔍 Research', count: research ? (research.trends?.length || 0) : 0 },
    { id: 'plan',     label: '🗺️ Plan',     count: plan?.contentPieces?.length || 0 },
    { id: 'assets',   label: '✨ Assets',   count: assets.length },
    { id: 'schedule', label: '📅 Schedule', count: scheduled.length },
  ] as const;

  return (
    <div style={{
      margin: '8px 0',
      borderRadius: 14,
      overflow: 'hidden',
      border: `1px solid ${isDarkMode ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)'}`,
      background: isDarkMode ? 'rgba(10,10,25,0.8)' : 'rgba(248,250,255,0.95)',
      backdropFilter: 'blur(20px)',
      boxShadow: isDarkMode
        ? '0 4px 30px rgba(99,102,241,0.1)'
        : '0 4px 20px rgba(99,102,241,0.08)',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.12))',
        borderBottom: `1px solid ${isDarkMode ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.12)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            boxShadow: '0 0 12px rgba(99,102,241,0.4)',
          }}>🎯</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>Campaign Command Center</div>
            <div style={{ fontSize: 10, color: '#6366f1', fontWeight: 600 }}>
              {PHASE_META[session.phase].icon} {PHASE_META[session.phase].label} · {session.brief.businessName}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20,
            background: `${PHASE_META[session.phase].color}22`, border: `1px solid ${PHASE_META[session.phase].color}44`,
            fontSize: 10, fontWeight: 700, color: PHASE_META[session.phase].color, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {session.brief.platforms.map(p => PLATFORM_META[p]?.icon || '📱').join(' ')}
          </div>
          {onClearSession && (
            <button
              onClick={onClearSession}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 14, opacity: 0.5, padding: 4
              }}
              title="Clear Session"
            >
              🗑️
            </button>
          )}
        </div>
      </div>

      {/* Phase Progress Bar */}
      <PhaseBar phase={session.phase} isDarkMode={isDarkMode} />

      {/* Batch Generating Status */}
      {session.isGeneratingBatch && session.campaignPlan?.contentPieces && (
        <div style={{ padding: '8px 14px', background: 'rgba(59,130,246,0.1)', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>⏳</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6' }}>Generating Assets in Parallel…</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6' }}>
            {session.campaignPlan.contentPieces.filter(p => p.assetUrl || p.status === 'ready').length} / {session.campaignPlan.contentPieces.length} Ready
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${border}`, background: bg, overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex: '1 0 auto', padding: '8px 4px', border: 'none', cursor: 'pointer',
            background: activeTab === tab.id
              ? (isDarkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)')
              : 'transparent',
            borderBottom: activeTab === tab.id ? '2px solid #6366f1' : '2px solid transparent',
            color: activeTab === tab.id ? '#6366f1' : textSecondary,
            fontSize: 11, fontWeight: activeTab === tab.id ? 700 : 500,
            transition: 'all 0.2s', whiteSpace: 'nowrap',
          }}>
            {tab.label}
            {tab.count > 0 && (
              <span style={{ marginLeft: 3, padding: '0 4px', borderRadius: 8, background: '#6366f1', color: '#fff', fontSize: 9, fontWeight: 700 }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ maxHeight: 280, overflowY: 'auto', padding: 12 }}>
        {/* RESEARCH TAB */}
        {activeTab === 'research' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!research ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: textSecondary, fontSize: 12, opacity: 0.7 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>🔍</div>
                Research in progress…
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <ResearchCard icon="📈" label="Trends Found" value={research.trends?.length || 0} isDarkMode={isDarkMode} />
                  <ResearchCard icon="#️⃣" label="Hashtags" value={research.hashtags?.length || 0} isDarkMode={isDarkMode} />
                  <ResearchCard icon="🔑" label="SEO Keywords" value={research.seoKeywords?.length || 0} isDarkMode={isDarkMode} />
                  <ResearchCard icon="⏰" label="Platforms Timed" value={Object.keys(research.bestPostingTimes || {}).length} isDarkMode={isDarkMode} />
                </div>

                {research.trends?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: textSecondary, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Top Trends</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {research.trends.slice(0, 5).map((t, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 7,
                          background: bg, border: `1px solid ${border}`,
                        }}>
                          <span style={{ fontSize: 14 }}>{t.engagement === 'high' ? '🔥' : t.engagement === 'medium' ? '📊' : '💡'}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.topic}</div>
                            <div style={{ fontSize: 10, color: textSecondary }}>{t.relevance}</div>
                          </div>
                          <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase',
                            background: t.engagement === 'high' ? 'rgba(239,68,68,0.15)' : t.engagement === 'medium' ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.15)',
                            color: t.engagement === 'high' ? '#ef4444' : t.engagement === 'medium' ? '#f59e0b' : '#64748b',
                          }}>{t.engagement}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {research.hashtags?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: textSecondary, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Top Hashtags</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {research.hashtags.slice(0, 12).map(h => (
                        <span key={h} style={{ fontSize: 11, padding: '3px 7px', borderRadius: 12, background: isDarkMode ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', color: '#6366f1', fontWeight: 500, border: '1px solid rgba(99,102,241,0.2)' }}>{h}</span>
                      ))}
                    </div>
                  </div>
                )}

                {research.audienceInsights && (
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: isDarkMode ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)', border: `1px solid rgba(99,102,241,0.15)` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>💡 Audience Insight</div>
                    <p style={{ fontSize: 11, color: textPrimary, margin: 0, lineHeight: 1.5 }}>{research.audienceInsights}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* PLAN TAB */}
        {activeTab === 'plan' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!plan ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: textSecondary, fontSize: 12, opacity: 0.7 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>🗺️</div>
                Campaign plan will appear here…
              </div>
            ) : (
              <>
                {plan.summary && (
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))', border: `1px solid rgba(99,102,241,0.15)` }}>
                    <p style={{ fontSize: 12, color: textPrimary, margin: 0, lineHeight: 1.5 }}>{plan.summary}</p>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {plan.contentPieces.map((piece, i) => {
                    const pMeta = PLATFORM_META[piece.platform] || { icon: '📱', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' };
                    return (
                      <div key={piece.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8,
                        background: bg, border: `1px solid ${border}`,
                      }}>
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: pMeta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                          {pMeta.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: pMeta.color }}>{piece.platform}</span>
                            <span style={{ fontSize: 10, padding: '0 4px', borderRadius: 4, background: `${pMeta.color}22`, color: pMeta.color, fontWeight: 600 }}>{CONTENT_TYPE_ICON[piece.type]} {piece.type}</span>
                          </div>
                          <p style={{ fontSize: 11, color: textPrimary, margin: 0, WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                            {piece.caption}
                          </p>
                          <div style={{ display: 'flex', gap: 2, marginTop: 3, flexWrap: 'wrap' }}>
                            {piece.hashtags.slice(0, 4).map(h => (
                              <span key={h} style={{ fontSize: 9, color: '#6366f1', fontWeight: 500 }}>{h}</span>
                            ))}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, flexShrink: 0,
                          textTransform: 'uppercase', letterSpacing: 0.3,
                          background: piece.status === 'ready' ? 'rgba(34,197,94,0.15)' : piece.status === 'generating' ? 'rgba(59,130,246,0.15)' : 'rgba(100,116,139,0.15)',
                          color: piece.status === 'ready' ? '#22c55e' : piece.status === 'generating' ? '#3b82f6' : '#64748b',
                        }}>{piece.status}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ASSETS TAB */}
        {activeTab === 'assets' && (
          <div>
            {assets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: textSecondary, fontSize: 12, opacity: 0.7 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✨</div>
                Generated assets will appear here…
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(plan?.contentPieces || []).map(piece => (
                  <ContentPieceCard
                    key={piece.id}
                    piece={piece}
                    isDarkMode={isDarkMode}
                    onEdit={instruction => onEditAsset(piece.id, instruction)}
                    onRegenerate={() => onRegenerateAsset(piece.id)}
                    onRetry={onRetryAsset ? () => onRetryAsset(piece.id) : undefined}
                    onApprove={onApproveAsset ? () => onApproveAsset(piece.id) : undefined}
                    onEditCaption={onEditCaption ? (newCap) => onEditCaption(piece.id, newCap) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* SCHEDULE TAB */}
        {activeTab === 'schedule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scheduled.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: textSecondary, fontSize: 12, opacity: 0.7 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📅</div>
                No posts scheduled yet…
              </div>
            ) : (
              scheduled
                .sort((a, b) => a.scheduledAt - b.scheduledAt)
                .map(post => (
                  <ScheduledPostRow
                    key={post.id}
                    post={post}
                    isDarkMode={isDarkMode}
                    isProcessing={isProcessing}
                    onReschedule={newTime => onReschedulePost(post.id, newTime)}
                    onPublish={onPublishPost ? () => onPublishPost(post) : undefined}
                  />
                ))
            )}
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div style={{
        padding: '8px 12px',
        borderTop: `1px solid ${border}`,
        background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 10, color: textSecondary }}>
          {session.brief.goal.toUpperCase()} · {session.brief.niche}
        </span>
        <span style={{ fontSize: 10, color: textSecondary }}>
          {new Date(session.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
};

export default MarketingAgentPanel;
