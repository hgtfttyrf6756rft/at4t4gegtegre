import React, { useCallback, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decode, decodeAudioData } from '../services/audioUtils';
import { ResearchReport } from '../types';

type AssistantMode = 'chat' | 'voice';

type ChatMessage = {
  id: string;
  role: 'user' | 'model';
  text: string;
};

interface SharedReportAssistantProps {
  report: ResearchReport;
  isDarkMode: boolean;
}

export const SharedReportAssistant: React.FC<SharedReportAssistantProps> = ({ report, isDarkMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AssistantMode>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const userTranscriptBufferRef = useRef<string>('');
  const assistantTranscriptBufferRef = useRef<string>('');

  const reportContext = useMemo(() => {
    const safeJson = JSON.stringify(report || {}, null, 2);
    const truncated = safeJson.length > 40000 ? safeJson.slice(0, 40000) : safeJson;
    return `=== SHARED RESEARCH REPORT (JSON) ===\n${truncated}\n=== END REPORT ===`;
  }, [report]);

  const systemInstruction = useMemo(() => {
    return (
      `You are an AI assistant embedded in a public, read-only shared research report.\n` +
      `You must answer questions strictly using the shared report context provided below.\n` +
      `If the user asks something not supported by the report, say so and suggest what to research next.\n\n` +
      `${reportContext}`
    );
  }, [reportContext]);

  const addMessage = useCallback((role: 'user' | 'model', text: string) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMessages(prev => [...prev, { id, role, text }]);
  }, []);

  const sendChatMessage = useCallback(async () => {
    const message = inputText.trim();
    if (!message) return;

    setInputText('');
    setError(null);
    addMessage('user', message);

    setIsProcessing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `${systemInstruction}\n\nUser question: ${message}`;
      const response: any = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          tools: [{ codeExecution: {} }],
        },
      });

      const text = (response && typeof response.text === 'string') ? response.text.trim() : '';
      addMessage('model', text || 'I could not generate a response.');
    } catch (e: any) {
      console.error('SharedReportAssistant chat failed', e);
      setError(e?.message || 'Chat failed');
      addMessage('model', 'Sorry—something went wrong generating a response.');
    } finally {
      setIsProcessing(false);
    }
  }, [addMessage, inputText, systemInstruction]);

  const disconnectVoice = useCallback(async () => {
    try {
      setConnectionStatus('disconnected');
      setIsSpeaking(false);
      nextStartTimeRef.current = 0;
      sourcesRef.current.forEach(s => s.stop());
      sourcesRef.current.clear();

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }

      if (inputContextRef.current) {
        await inputContextRef.current.close();
        inputContextRef.current = null;
      }

      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      sessionRef.current = null;
    } catch (e) {
      console.error('SharedReportAssistant disconnect failed', e);
    }
  }, []);

  const connectVoice = useCallback(async () => {
    if (connectionStatus === 'connected' || connectionStatus === 'connecting') return;

    setError(null);
    setConnectionStatus('connecting');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = outputCtx;
      inputContextRef.current = inputCtx;

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setConnectionStatus('connected');

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const { serverContent } = msg;

            const clientContent = (msg as any).clientContent;
            if (clientContent?.inputTranscription?.text) {
              userTranscriptBufferRef.current += clientContent.inputTranscription.text;
            }

            if (clientContent?.turnComplete) {
              const trimmed = userTranscriptBufferRef.current.trim();
              if (trimmed) {
                addMessage('user', trimmed);
              }
              userTranscriptBufferRef.current = '';
            }

            if (serverContent?.outputTranscription?.text) {
              assistantTranscriptBufferRef.current += serverContent.outputTranscription.text;
            }

            if (serverContent?.turnComplete) {
              const trimmed = assistantTranscriptBufferRef.current.trim();
              if (trimmed) {
                addMessage('model', trimmed);
              }
              assistantTranscriptBufferRef.current = '';
            }

            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
              setIsSpeaking(true);
              const ctx = audioContextRef.current;

              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNode);

              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onclose: () => {
            setConnectionStatus('disconnected');
            setIsSpeaking(false);
          },
          onerror: (e) => {
            console.error('SharedReportAssistant live error', e);
            setConnectionStatus('error');
            setError('Voice connection failed.');
          },
        },
      });

      sessionRef.current = sessionPromise;
    } catch (e: any) {
      console.error('SharedReportAssistant connectVoice failed', e);
      setConnectionStatus('error');
      setError(e?.message || 'Failed to initialize voice');
      await disconnectVoice();
    }
  }, [addMessage, connectionStatus, disconnectVoice, systemInstruction]);

  const handleSend = useCallback(async () => {
    if (isProcessing) return;

    if (mode === 'chat') {
      await sendChatMessage();
      return;
    }

    const message = inputText.trim();
    if (!message) return;

    setInputText('');
    setError(null);

    if (connectionStatus === 'connected' && sessionRef.current) {
      addMessage('user', message);
      try {
        const session = await sessionRef.current;
        await session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: message }] }],
          turnComplete: true,
        });
      } catch (e) {
        console.error('SharedReportAssistant failed to send voice text', e);
        addMessage('model', 'Message failed to send over voice connection.');
      }
      return;
    }

    addMessage('model', 'Start voice mode (mic) first, or switch to chat mode.');
  }, [addMessage, connectionStatus, inputText, isProcessing, mode, sendChatMessage]);

  const panelClasses = isDarkMode
    ? 'bg-[#1c1c1e] border-[#3a3a3c] text-white'
    : 'bg-white border-gray-200 text-gray-900';

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="group relative w-14 h-14 rounded-full focus:outline-none"
          title="Ask about this report"
          aria-label="Ask about this report"
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-blue-600 via-cyan-400 to-indigo-500 opacity-60 blur-[10px] transition-all group-hover:opacity-90 group-hover:blur-[14px]" />
          <span
            className={`relative flex h-full w-full items-center justify-center rounded-full border shadow-2xl backdrop-blur-xl transition-all group-active:scale-[0.98] ${isDarkMode
              ? 'bg-black/45 border-white/10 text-white group-hover:bg-black/60'
              : 'bg-white/85 border-black/10 text-black group-hover:bg-white'
              } focus:ring-4 focus:ring-blue-500/30`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        </button>
      ) : (
        <div className={`w-[92vw] max-w-[380px] h-[70vh] max-h-[560px] rounded-3xl shadow-2xl border overflow-hidden flex flex-col ${panelClasses}`}>
          <div className={`px-4 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-[#0071e3]/20' : 'bg-blue-50'}`}>
                <svg className={`w-4 h-4 ${isDarkMode ? 'text-[#63b3ff]' : 'text-[#0071e3]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">AI Assistant</div>
                <div className={`text-[11px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {mode === 'chat' ? 'Chat (gemini-2.5-flash)' : 'Voice (Gemini Live)'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setMode(prev => (prev === 'chat' ? 'voice' : 'chat'))}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isDarkMode
                  ? 'bg-white/10 hover:bg-white/20'
                  : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                title={mode === 'chat' ? 'Switch to voice' : 'Switch to chat'}
              >
                {mode === 'chat' ? 'Voice' : 'Chat'}
              </button>

              {mode === 'voice' && (
                <button
                  onClick={() => {
                    if (connectionStatus === 'connected') {
                      disconnectVoice();
                    } else {
                      connectVoice();
                    }
                  }}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${connectionStatus === 'connected'
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : isDarkMode ? 'bg-[#0071e3] text-white hover:bg-[#0a84ff]' : 'bg-[#0071e3] text-white hover:bg-[#0a84ff]'
                    }`}
                  title={connectionStatus === 'connected' ? 'Disconnect voice' : 'Connect voice'}
                >
                  {connectionStatus === 'connected' ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z" /></svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M19 11a7 7 0 01-14 0H3a9 9 0 006 8.65V22h6v-2.35A9 9 0 0021 11h-2z" /></svg>
                  )}
                </button>
              )}

              <button
                onClick={() => setIsOpen(false)}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${isDarkMode
                  ? 'hover:bg-white/10 text-white/70 hover:text-white'
                  : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'
                  }`}
                title="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${isDarkMode ? 'bg-black' : 'bg-gray-50'}`}>
            {messages.length === 0 && (
              <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Ask anything about this report. I will answer using the report context.
              </div>
            )}

            {messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user'
                  ? 'bg-[#0071e3] text-white'
                  : (isDarkMode ? 'bg-[#2d2d2f] text-[#e5e5ea]' : 'bg-white border border-gray-200 text-gray-900')
                  }`}>
                  {m.role === 'model' ? (
                    <ReactMarkdown className={isDarkMode ? 'prose prose-invert max-w-none' : 'prose max-w-none'}>
                      {m.text}
                    </ReactMarkdown>
                  ) : (
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  )}
                </div>
              </div>
            ))}

            {isProcessing && (
              <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                Thinking...
              </div>
            )}

            {mode === 'voice' && connectionStatus === 'connected' && (
              <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                {isSpeaking ? 'Speaking…' : 'Listening…'}
              </div>
            )}

            {error && (
              <div className={`text-xs ${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>
                {error}
              </div>
            )}
          </div>

          <div className={`p-3 border-t ${isDarkMode ? 'border-white/10 bg-black/30' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-center gap-2">
              <input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSend();
                }}
                placeholder={mode === 'voice' ? 'Type a message (optional)…' : 'Ask about the report…'}
                className={`flex-1 rounded-xl px-3 py-2 text-sm outline-none border ${isDarkMode
                  ? 'bg-[#2d2d2f] text-white placeholder-[#636366] border-[#3d3d3f]/50'
                  : 'bg-gray-100 text-gray-900 placeholder-gray-500 border-gray-200'
                  }`}
              />
              <button
                disabled={isProcessing}
                onClick={handleSend}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isDarkMode
                  ? 'bg-white/10 hover:bg-white/20 text-white disabled:opacity-40'
                  : 'bg-[#0071e3] hover:bg-[#0a84ff] text-white disabled:opacity-40'
                  }`}
                title="Send"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
