import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decode, decodeAudioData } from '../services/audioUtils';

export const VoiceAssistant: React.FC = () => {
  const [connected, setConnected] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Refs for audio handling to avoid re-renders
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null); // To hold the live session
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const connect = async () => {
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Setup Audio Contexts
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = outputCtx;
      inputContextRef.current = inputCtx;
      
      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination); // Ensure output goes to speakers

      // Get Mic Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log("Live Session Open");
            setConnected(true);

            // Stream Audio Input
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
            // Handle Audio Output
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
                setSpeaking(true);
                const ctx = audioContextRef.current;
                
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                const audioBuffer = await decodeAudioData(
                    decode(base64Audio),
                    ctx,
                    24000,
                    1
                );

                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputNode); // Connect to gain node -> destination
                
                source.addEventListener('ended', () => {
                    sourcesRef.current.delete(source);
                    if (sourcesRef.current.size === 0) setSpeaking(false);
                });

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
            }

            // Handle Interruptions
            if (msg.serverContent?.interrupted) {
                sourcesRef.current.forEach(s => s.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                setSpeaking(false);
            }
          },
          onclose: () => {
            setConnected(false);
            setSpeaking(false);
          },
          onerror: (err) => {
             console.error("Live API Error", err);
             setError("Connection error. Check console.");
             setConnected(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          systemInstruction: "You are a helpful, creative assistant in a design studio application. Help the user brainstorm ideas for images and videos."
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (e) {
      console.error(e);
      setError("Failed to initialize audio or connection.");
    }
  };

  const disconnect = () => {
    // There is no explicit disconnect method on the session wrapper in SDK yet exposed easily 
    // without keeping the promise, but closing contexts stops flow.
    // Ideally we would call session.close() if exposed.
    
    // For now, reload/stop tracks
    if (inputContextRef.current) inputContextRef.current.close();
    if (audioContextRef.current) audioContextRef.current.close();
    setConnected(false);
    setSpeaking(false);
    
    // Quick reload hack to ensure clean slate for demo purposes as SDK doesn't always expose clean close
    // In production, manage the MediaStreamTracks and Session object references carefully.
    window.location.reload(); 
  };

  return (
    <div className="h-full flex flex-col items-center justify-center relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-gray-950 to-gray-950 -z-10"></div>
      
      <div className="text-center space-y-8 z-10">
        <h2 className="text-4xl font-bold text-white mb-2">Live Conversation</h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Brainstorm ideas naturally with Gemini using the Native Audio Live API.
        </p>

        <div className="relative">
          {/* Visualizer Circle */}
          <div className={`w-48 h-48 rounded-full flex items-center justify-center transition-all duration-300 ${
            connected 
              ? speaking 
                 ? 'bg-indigo-500 shadow-[0_0_50px_rgba(99,102,241,0.6)] scale-110' 
                 : 'bg-indigo-900/50 shadow-[0_0_20px_rgba(99,102,241,0.2)]'
              : 'bg-gray-800'
          }`}>
             <span className="text-6xl">
               {connected ? (speaking ? '🗣️' : '👂') : '🎙️'}
             </span>
          </div>
          
          {/* Ripple Effect */}
          {connected && (
             <div className="absolute inset-0 border-4 border-indigo-500/30 rounded-full animate-ping pointer-events-none"></div>
          )}
        </div>

        <div className="flex gap-4 justify-center">
          {!connected ? (
            <button
              onClick={connect}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95"
            >
              Start Conversation
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95"
            >
              End Session
            </button>
          )}
        </div>
        
        {error && <p className="text-red-400 mt-4">{error}</p>}
      </div>
    </div>
  );
};