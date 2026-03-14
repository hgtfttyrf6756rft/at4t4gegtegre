import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ResearchProject, AssistantVersion } from '../types';
import { authFetch } from '../services/authFetch';
import { assistantVersionService } from '../services/assistantVersionService';
import { auth } from '../services/firebase';

const SLOTS = [
  { id: 'header-actions', label: 'Header Actions', description: 'Compact buttons shown in the assistant header' },
  { id: 'input-toolbar', label: 'Input Toolbar', description: 'Extra controls above the message input' },
  { id: 'side-panel', label: 'Side Panel', description: 'A collapsible panel for custom widgets/dashboards' },
  { id: 'message-footer', label: 'Message Footer', description: 'UI element below each AI response' },
] as const;

type SlotId = typeof SLOTS[number]['id'];

interface BuilderMessage {
  role: 'user' | 'assistant';
  text: string;
  codePreview?: { slot: SlotId; code: string };
  timestamp: number;
}

interface AssistantStudioProps {
  project: ResearchProject;
  isDarkMode: boolean;
  onClose: () => void;
  // Pass these through so the live preview can render the assistant properly
  assistantProps?: Record<string, any>;
}

export const AssistantStudio: React.FC<AssistantStudioProps> = ({
  project,
  isDarkMode,
  onClose,
  assistantProps = {},
}) => {
  const userId = auth.currentUser?.uid;

  // ─── Version state ─────────────────────────────────────────────────────────
  const [versions, setVersions] = useState<AssistantVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState<AssistantVersion | null>(null);
  const [draftVersion, setDraftVersion] = useState<AssistantVersion | null>(null); // unsaved edits
  const [loadingVersions, setLoadingVersions] = useState(true);

  // ─── Builder chat state ────────────────────────────────────────────────────
  const [messages, setMessages] = useState<BuilderMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<SlotId>('side-panel');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewSlot, setPreviewSlot] = useState<SlotId | null>(null);
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [newVersionName, setNewVersionName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // ─── Preview panel state ────────────────────────────────────────────────────
  const [showCode, setShowCode] = useState(false);
  const [activeCodeSlot, setActiveCodeSlot] = useState<SlotId>('side-panel');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load versions on mount
  useEffect(() => {
    if (!userId) return;
    assistantVersionService.getVersionsForProject(userId, project.id).then(vs => {
      setVersions(vs);
      const active = vs.find(v => v.isActive) || null;
      setActiveVersion(active);
      setDraftVersion(active ? { ...active } : null);
      setLoadingVersions(false);
    });
  }, [userId, project.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Create a new version ──────────────────────────────────────────────────
  const handleCreateVersion = async () => {
    if (!userId || !newVersionName.trim()) return;
    setIsSaving(true);
    const id = await assistantVersionService.saveVersion(userId, {
      projectId: project.id,
      name: newVersionName.trim(),
      description: '',
      plugins: {},
      installedApis: [],
      apiKeys: {},
      isActive: false,
    });
    const updated = await assistantVersionService.getVersionsForProject(userId, project.id);
    setVersions(updated);
    const created = updated.find(v => v.id === id) || null;
    setDraftVersion(created);
    setActiveVersion(created);
    setNewVersionName('');
    setIsCreatingVersion(false);
    setIsSaving(false);

    setMessages([{
      role: 'assistant',
      text: `✨ Created version **"${newVersionName.trim()}"**. What would you like to add to this version? For example:\n\n- "Add a weather widget to the side panel using the OpenWeatherMap API"\n- "Add a quick 'Copy Summary' button to the header"\n- "Show a task progress bar above the input"`,
      timestamp: Date.now(),
    }]);
  };

  // ─── Generate plugin code via AI ───────────────────────────────────────────
  const handleGenerate = async () => {
    if (!inputText.trim() || isGenerating || !draftVersion) return;
    const userMsg: BuilderMessage = { role: 'user', text: inputText.trim(), timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsGenerating(true);

    try {
      const res = await authFetch(`/api/agent?op=generate-plugin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: inputText.trim(),
          slot: selectedSlot,
          currentCode: draftVersion.plugins[selectedSlot] || '',
          versionId: draftVersion.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `API error ${res.status}`);
      }

      const { code } = await res.json();

      // Update draft
      const updatedDraft: AssistantVersion = {
        ...draftVersion,
        plugins: { ...draftVersion.plugins, [selectedSlot]: code },
        updatedAt: Date.now(),
      };
      setDraftVersion(updatedDraft);

      const slotLabel = SLOTS.find(s => s.id === selectedSlot)?.label || selectedSlot;
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `✅ Generated plugin for **${slotLabel}**. You can see a preview on the right. Click **Deploy** when you're happy with it.`,
        codePreview: { slot: selectedSlot, code },
        timestamp: Date.now(),
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `❌ Generation failed: ${e?.message || 'Unknown error'}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Deploy (save + activate) the draft version ────────────────────────────
  const handleDeploy = async () => {
    if (!userId || !draftVersion) return;
    setIsSaving(true);
    try {
      await authFetch(`/api/agent?op=save-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draftVersion, isActive: true }),
      });
      const updated = await assistantVersionService.getVersionsForProject(userId, project.id);
      setVersions(updated);
      const newActive = updated.find(v => v.id === draftVersion.id) || null;
      setActiveVersion(newActive);
      setDraftVersion(newActive);
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `🚀 **"${draftVersion.name}"** is now live! Users with this project will see your custom version. You can switch back to Standard at any time.`,
        timestamp: Date.now(),
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `❌ Deploy failed: ${e?.message}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Switch to a different version ─────────────────────────────────────────
  const handleSwitchVersion = (version: AssistantVersion | null) => {
    setDraftVersion(version ? { ...version } : null);
    setMessages([{
      role: 'assistant',
      text: version
        ? `Loaded version **"${version.name}"**. What changes would you like to make?`
        : `Switched to **Standard** (no customizations). Pick a version above to start editing.`,
      timestamp: Date.now(),
    }]);
  };

  // ─── Theme helpers ──────────────────────────────────────────────────────────
  const bg = isDarkMode ? 'bg-[#0a0a0c]' : 'bg-gray-50';
  const panelBg = isDarkMode ? 'bg-[#111113] border-white/10' : 'bg-white border-gray-200';
  const textPrimary = isDarkMode ? 'text-white' : 'text-gray-900';
  const textSecondary = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const inputCls = isDarkMode
    ? 'bg-[#1c1c1e] border-white/10 text-white placeholder-gray-600 focus:border-indigo-500/50'
    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-indigo-400';

  return (
    <div className={`fixed inset-0 z-[200] flex flex-col pointer-events-auto ${bg}`}>
      {/* ─── Top Bar ──────────────────────────────────────────────────────── */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-white/10 bg-[#111113]' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>
            </div>
            <div>
              <h1 className={`text-sm font-semibold leading-none ${textPrimary}`}>Assistant Studio</h1>
              <p className={`text-[10px] mt-0.5 ${textSecondary}`}>{project.name}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Version selector */}
          <div className="flex items-center gap-1.5">
            <span className={`text-xs ${textSecondary}`}>Version:</span>
            <select
              value={draftVersion?.id || ''}
              onChange={e => {
                const v = versions.find(v => v.id === e.target.value) || null;
                handleSwitchVersion(v);
              }}
              className={`text-xs rounded-lg border px-2 py-1 outline-none ${inputCls}`}
            >
              <option value="">Standard (default)</option>
              {versions.map(v => (
                <option key={v.id} value={v.id}>{v.name}{v.isActive ? ' ✓' : ''}</option>
              ))}
            </select>
            <button
              onClick={() => setIsCreatingVersion(true)}
              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${isDarkMode ? 'border-white/10 hover:bg-white/10 text-gray-400 hover:text-white' : 'border-gray-200 hover:bg-gray-100 text-gray-500 hover:text-gray-700'}`}
            >
              + New
            </button>
          </div>

          {/* Deploy button */}
          {draftVersion && (
            <button
              onClick={handleDeploy}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs font-medium transition-all disabled:opacity-50"
            >
              {isSaving ? <span className="animate-spin">⟳</span> : <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>}
              Deploy
            </button>
          )}
        </div>
      </div>

      {/* ─── New Version Modal ─────────────────────────────────────────────── */}
      {isCreatingVersion && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={`w-80 rounded-2xl border p-5 shadow-2xl ${panelBg}`}>
            <h2 className={`font-semibold mb-3 ${textPrimary}`}>New Version</h2>
            <input
              autoFocus
              value={newVersionName}
              onChange={e => setNewVersionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateVersion()}
              placeholder="e.g. Social Media Version"
              className={`w-full px-3 py-2 rounded-lg border text-sm outline-none mb-3 ${inputCls}`}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateVersion}
                disabled={!newVersionName.trim() || isSaving}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setIsCreatingVersion(false)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${isDarkMode ? 'border-white/10 text-gray-400 hover:bg-white/10' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Main Split Layout ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ─── LEFT: Builder Chat (40%) ──────────────────────────────────── */}
        <div className={`w-[40%] flex flex-col border-r ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
          {/* Slot selector */}
          <div className={`flex items-center gap-1.5 px-3 py-2.5 border-b overflow-x-auto ${isDarkMode ? 'border-white/10 bg-[#111113]' : 'border-gray-200 bg-gray-50'}`}>
            {SLOTS.map(slot => (
              <button
                key={slot.id}
                onClick={() => setSelectedSlot(slot.id)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${selectedSlot === slot.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : isDarkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-white/10' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${isDarkMode ? 'bg-[#0a0a0c]' : 'bg-gray-50'}`}>
            {!draftVersion && !loadingVersions && (
              <div className={`rounded-2xl p-4 text-sm border ${isDarkMode ? 'border-white/10 bg-[#111113] text-gray-300' : 'border-gray-200 bg-white text-gray-700'}`}>
                <div className="text-2xl mb-2">✨</div>
                <p className="font-medium mb-1">Welcome to Assistant Studio</p>
                <p className={`text-xs ${textSecondary}`}>Create a new version to start customizing your AI assistant with real API integrations, custom widgets, and more.</p>
                <button
                  onClick={() => setIsCreatingVersion(true)}
                  className="mt-3 w-full py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
                >
                  + Create Your First Version
                </button>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : isDarkMode ? 'bg-[#1c1c1e] text-gray-200' : 'bg-white border border-gray-200 text-gray-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                  {msg.codePreview && (
                    <button
                      onClick={() => { setShowCode(true); setActiveCodeSlot(msg.codePreview!.slot); }}
                      className={`mt-2 flex items-center gap-1 text-xs opacity-70 hover:opacity-100 underline`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> View generated code
                    </button>
                  )}
                </div>
              </div>
            ))}

            {isGenerating && (
              <div className="flex justify-start">
                <div className={`rounded-2xl px-3.5 py-2.5 text-sm ${isDarkMode ? 'bg-[#1c1c1e] text-gray-400' : 'bg-white border border-gray-200 text-gray-500'}`}>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                    Generating plugin…
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {draftVersion && (
            <div className={`px-3 py-3 border-t ${isDarkMode ? 'border-white/10 bg-[#111113]' : 'border-gray-200 bg-white'}`}>
              <div className={`flex gap-2 items-end px-3 py-2 rounded-2xl border ${inputCls}`}>
                <textarea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
                  }}
                  placeholder={`Describe what to add to the ${SLOTS.find(s => s.id === selectedSlot)?.label}…`}
                  rows={2}
                  className={`flex-1 resize-none outline-none bg-transparent text-sm ${isDarkMode ? 'text-white placeholder-gray-600' : 'text-gray-900 placeholder-gray-400'}`}
                />
                <button
                  onClick={handleGenerate}
                  disabled={!inputText.trim() || isGenerating}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                </button>
              </div>
              <p className={`text-[10px] mt-1.5 px-1 ${textSecondary}`}>
                Target: <strong className="text-indigo-400">{SLOTS.find(s => s.id === selectedSlot)?.label}</strong> · Press Enter to send
              </p>
            </div>
          )}
        </div>

        {/* ─── RIGHT: Live Preview (60%) ─────────────────────────────────── */}
        <div className={`flex-1 flex flex-col ${isDarkMode ? 'bg-[#050507]' : 'bg-gray-100'}`}>
          {/* Preview header */}
          <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isDarkMode ? 'border-white/10 bg-[#111113]' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              <span className={`text-xs font-medium ${textPrimary}`}>Live Preview</span>
              {draftVersion && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isDarkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                  {draftVersion.name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCode(!showCode)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${showCode ? 'bg-indigo-600 text-white' : isDarkMode ? 'text-gray-400 hover:bg-white/10 hover:text-white' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                Code
              </button>
            </div>
          </div>

          {showCode ? (
            /* ── Code view ── */
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className={`flex gap-1 px-3 pt-3 border-b pb-3 ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                {SLOTS.map(slot => (
                  <button
                    key={slot.id}
                    onClick={() => setActiveCodeSlot(slot.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${activeCodeSlot === slot.id
                      ? 'bg-indigo-600 text-white'
                      : isDarkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
              <pre className={`flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-800'}`}>
                {draftVersion?.plugins[activeCodeSlot] || `// No plugin code yet for "${SLOTS.find(s => s.id === activeCodeSlot)?.label}"\n// Ask the AI builder on the left to add something here!`}
              </pre>
            </div>
          ) : (
            /* ── Preview view — assistant rendered in an iframe-like container ── */
            <div className="flex-1 flex items-center justify-center p-6">
              <div className={`relative w-[360px] h-[560px] rounded-3xl shadow-2xl border overflow-hidden ${isDarkMode ? 'border-white/10 bg-[#050509]' : 'border-black/10 bg-white'}`}>
                {/* Simulated assistant header */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-[#5e5ce6] flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    </div>
                    <div>
                      <p className={`text-xs font-semibold ${textPrimary}`}>{project.agent?.name || 'AI Assistant'}</p>
                      <p className={`text-[9px] ${textSecondary}`}>{draftVersion?.name || 'Standard'}</p>
                    </div>
                  </div>
                  {/* Header actions slot preview */}
                  {draftVersion?.plugins['header-actions'] ? (
                    <div className={`text-[10px] px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-50 text-green-600'}`}>
                      ✓ header plugin
                    </div>
                  ) : null}
                </div>

                {/* Messages area preview */}
                <div className={`flex-1 p-3 ${isDarkMode ? 'bg-black' : 'bg-gray-50'}`} style={{ height: '380px', overflowY: 'auto' }}>
                  <div className={`text-center py-8 ${textSecondary}`}>
                    <div className={`w-10 h-10 mx-auto mb-2 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <p className="text-xs">Start a conversation</p>
                  </div>

                  {/* Side panel slot preview badge */}
                  {draftVersion?.plugins['side-panel'] && (
                    <div className={`text-xs text-center mt-4 p-2 rounded-lg ${isDarkMode ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-indigo-50 text-indigo-600 border border-indigo-200'}`}>
                      ✨ Side panel plugin active
                    </div>
                  )}
                </div>

                {/* Input toolbar slot preview */}
                {draftVersion?.plugins['input-toolbar'] && (
                  <div className={`px-3 py-1.5 border-t text-xs ${isDarkMode ? 'border-white/10 bg-[#111] text-indigo-400' : 'border-gray-200 bg-gray-50 text-indigo-600'}`}>
                    ✨ Input toolbar plugin active
                  </div>
                )}

                {/* Input area */}
                <div className={`flex items-center gap-2 px-3 py-2.5 border-t ${isDarkMode ? 'border-white/10 bg-[#111]' : 'border-gray-200 bg-white'}`}>
                  <div className={`flex-1 h-7 rounded-full border ${isDarkMode ? 'border-white/10 bg-[#1c1c1e]' : 'border-gray-200 bg-gray-50'}`} />
                  <div className="w-7 h-7 rounded-full bg-[#5e5ce6] flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                  </div>
                </div>
              </div>

              {/* Plugin status badges */}
              <div className="absolute bottom-6 right-6 space-y-1.5">
                {SLOTS.map(slot => {
                  const hasPlugin = draftVersion?.plugins[slot.id];
                  if (!hasPlugin) return null;
                  return (
                    <div
                      key={slot.id}
                      className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full font-medium ${isDarkMode ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-green-50 text-green-700 border border-green-200'}`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      {slot.label}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
