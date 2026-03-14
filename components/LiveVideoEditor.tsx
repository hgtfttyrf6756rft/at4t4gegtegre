import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createDecartClient, models } from '@decartai/sdk';
import type { DecartSDKError } from '@decartai/sdk';
import { CreditOperation } from '../services/creditService';

interface LiveVideoEditorProps {
    className?: string;
    imageReference?: File | null;
    imagePreviewUrl?: string | null;
    onSelectImage?: () => void;
    onRemoveImage?: () => void;
    isDarkMode?: boolean;
    checkCredits: (operation: CreditOperation) => Promise<boolean>;
    deductCredits: (operation: CreditOperation) => Promise<boolean>;
}

export const LiveVideoEditor: React.FC<LiveVideoEditorProps> = ({
    className,
    isDarkMode = false,
    imageReference,
    imagePreviewUrl,
    onSelectImage,
    onRemoveImage,
    checkCredits,
    deductCredits,
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [realtimeClient, setRealtimeClient] = useState<any | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [prompt, setPrompt] = useState('Add sunglasses');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Recording State
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const clientRef = useRef<any | null>(null);

    // Sync ref with state
    useEffect(() => {
        clientRef.current = realtimeClient;
    }, [realtimeClient]);

    // Handle Image Reference Updates
    useEffect(() => {
        if (realtimeClient && isConnected && imageReference) {
            console.log("Setting Image Reference:", imageReference.name);
            realtimeClient.setImage(imageReference).catch((err: any) => {
                console.error("Failed to set image reference:", err);
                setError(`Failed to set image: ${err.message}`);
            });
        }
    }, [realtimeClient, isConnected, imageReference]);

    // Cleanup on unmount ONLY
    useEffect(() => {
        return () => {
            // Use ref to access latest client without triggering re-run
            if (clientRef.current) {
                clientRef.current.disconnect();
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const handleConnect = async () => {
        // Credit Check
        const hasCredits = await checkCredits('videoLive');
        if (!hasCredits) return;

        const success = await deductCredits('videoLive');
        if (!success) {
            setError('Failed to deduct credits');
            return;
        }

        setError(null);
        setIsGenerating(true);

        try {
            console.log("Initializing Realtime Session...");

            // 1. Get user's camera stream with correct model specs
            // Use 'lucy_v2v_14b_rt' for Character Reference support as per documentation
            const model = models.realtime("lucy_v2v_14b_rt");
            console.log("Selected Model:", model);

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: {
                    frameRate: model.fps,
                    width: model.width,
                    height: model.height,
                },
            });
            streamRef.current = stream;
            console.log("Local Stream Acquired:", stream.id);

            // 2. Create client
            const apiKey = import.meta.env.VITE_DECART_API_KEY;

            if (!apiKey) {
                console.error("CRITICAL: VITE_DECART_API_KEY is missing!");
                setError("API Key missing. Check .env file.");
                setIsGenerating(false);
                return;
            }

            const client = createDecartClient({
                apiKey: apiKey,
            });

            // 3. Connect
            console.log("Connecting to Decart Realtime API...");

            const rtClient = await client.realtime.connect(stream, {
                model,
                onRemoteStream: (transformedStream) => {
                    console.log("Received Remote Stream:", transformedStream.id);
                    if (videoRef.current) {
                        videoRef.current.srcObject = transformedStream;
                        // Ensure video plays for WebRTC
                        videoRef.current.play().catch(e => console.error("Auto-play failed:", e));
                    }
                },
            });

            rtClient.on("connectionChange", (state: string) => {
                console.log("Connection State Changed:", state);
                setIsConnected(state === 'connected');
                if (state === 'disconnected') {
                    console.log("Session Disconnected.");
                }
            });

            rtClient.on("error", (err: DecartSDKError) => {
                console.error('Decart Client Error:', err);
                setError(`SDK Error: ${err.message}`);
                setIsConnected(false);
            });

            setRealtimeClient(rtClient);
            setIsConnected(true);

            // Apply initial prompt
            if (prompt.trim()) {
                console.log("Sending initial prompt:", prompt);
                rtClient.setPrompt(prompt);
            }

            // Apply initial image if exists
            if (imageReference) {
                console.log("Sending initial image reference:", imageReference.name);
                rtClient.setImage(imageReference);
            }

        } catch (err: any) {
            console.error('Failed to connect:', err);
            setError(err.message || 'Failed to start live session');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDisconnect = useCallback(() => {
        if (realtimeClient) {
            realtimeClient.disconnect();
            setRealtimeClient(null);
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setIsConnected(false);
    }, [realtimeClient]);

    const handleSendPrompt = useCallback(async () => {
        if (!realtimeClient || !isConnected || !prompt.trim()) return;

        try {
            realtimeClient.setPrompt(prompt);
        } catch (error) {
            console.error('Error sending prompt:', error);
            setError('Failed to apply edit');
        }
    }, [realtimeClient, isConnected, prompt]);

    // Recording Handlers
    const handleStartRecording = useCallback(() => {
        if (!videoRef.current || !videoRef.current.srcObject) {
            setError("No video stream to record");
            return;
        }

        try {
            const stream = videoRef.current.srcObject as MediaStream;
            const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });

            chunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `decart-session-${Date.now()}.webm`;
                a.click();
                URL.revokeObjectURL(url);
                chunksRef.current = [];
            };

            recorder.start();
            mediaRecorderRef.current = recorder;
            setIsRecording(true);
        } catch (err: any) {
            console.error("Failed to start recording:", err);
            setError("Failed to start recording (MediaRecorder not supported?)");
        }
    }, []);

    const handleStopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, [isRecording]);

    return (
        <div className={`flex flex-col h-full ${isDarkMode ? 'bg-[#1c1c1e]' : 'bg-white'} ${className}`}>
            <div className={`p-4 border-b flex justify-between items-center ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                <h2 className={`text-md font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    Live Video Editor
                </h2>
                <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm text-gray-400">{isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
            </div>

            <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
                {/* Video Output */}
                <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    autoPlay
                    playsInline
                    muted // Muted to prevent feedback loop if audio is enabled
                />

                {!isConnected && !isGenerating && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 text-center">
                        <div>
                            <p className="mb-4 text-gray-400">Connect to start real-time video editing</p>
                            <button
                                onClick={handleConnect}
                                className="bg-[#0071e3] hover:bg-[#0077ED] text-white px-6 py-2 rounded-full font-medium transition-colors shadow-lg shadow-blue-500/20"
                            >
                                Start Live Session
                            </button>
                        </div>
                    </div>
                )}

                {isGenerating && !isConnected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
                    </div>
                )}

                {error && (
                    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm max-w-md text-center">
                        {error}
                        <button onClick={() => setError(null)} className="ml-2 text-white/80 hover:text-white">&times;</button>
                    </div>
                )}
            </div>

            <div className={`p-4 border-t flex flex-col gap-4 ${isDarkMode ? 'bg-[#1c1c1e] border-[#3d3d3f]' : 'bg-white border-gray-200'}`}>

                <div className="flex gap-2">
                    <div className="relative flex-1 group">
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Describe your edit (e.g. 'Add a hat', 'Make hair red')..."
                            className={`w-full rounded-xl pl-4 pr-12 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all ${isDarkMode
                                ? 'bg-[#111111] border border-[#3d3d3f]/60 text-white placeholder:text-[#636366]'
                                : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-500'
                                }`}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendPrompt()}
                            disabled={!isConnected}
                        />

                        {/* Integrated Character Reference Button */}
                        {(onSelectImage || imageReference) && (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                                {imagePreviewUrl ? (
                                    <div className="relative h-8 w-8 rounded overflow-hidden border border-white/20 group/img cursor-pointer">
                                        <img
                                            src={imagePreviewUrl}
                                            alt="Ref"
                                            className="w-full h-full object-cover"
                                            onClick={onSelectImage}
                                            title="Change character reference"
                                        />
                                        {onRemoveImage && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRemoveImage();
                                                }}
                                                className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                                                title="Remove reference"
                                            >
                                                <span className="text-white text-[10px] font-bold">&times;</span>
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        onClick={onSelectImage}
                                        className={`h-8 w-8 flex items-center justify-center rounded-full transition-colors ${isDarkMode
                                            ? 'text-[#86868b] hover:text-white hover:bg-white/10'
                                            : 'text-gray-400 hover:text-gray-900 hover:bg-black/5'
                                            }`}
                                        title="Select character reference image"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={handleSendPrompt}
                        disabled={!isConnected || !prompt.trim()}
                        className={`px-6 py-2.5 rounded-xl font-medium text-sm transition-all shadow-sm ${!isConnected || !prompt.trim()
                            ? isDarkMode ? 'bg-[#2c2c2e] text-[#636366] cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-[#0071e3] hover:bg-[#0077ED] text-white hover:shadow-md'
                            }`}
                    >
                        Update Edit
                    </button>
                    {isConnected && (
                        <>
                            {!isRecording ? (
                                <button
                                    onClick={handleStartRecording}
                                    className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-colors flex items-center gap-1.5 ${isDarkMode
                                        ? 'bg-gray-800 text-white hover:bg-gray-700'
                                        : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
                                        }`}
                                    title="Record Session"
                                >
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                    Record
                                </button>
                            ) : (
                                <button
                                    onClick={handleStopRecording}
                                    className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-colors flex items-center gap-1.5 ${isDarkMode
                                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                                        : 'bg-red-50 text-red-600 hover:bg-red-100'
                                        }`}
                                    title="Stop Recording"
                                >
                                    <div className="w-2.5 h-2.5 rounded-sm bg-current" />
                                    Stop
                                </button>
                            )}

                            <button
                                onClick={handleDisconnect}
                                className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-colors ${isDarkMode
                                    ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                                    }`}
                            >
                                Disconnect
                            </button>
                        </>
                    )}
                </div>
                <div className={`text-[10px] text-center ${isDarkMode ? 'text-[#636366]' : 'text-gray-400'}`}>
                    Powered by Decart Realtime API • WebRTC
                </div>
            </div>
        </div>
    );
};
