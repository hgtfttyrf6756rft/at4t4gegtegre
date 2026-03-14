import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    ComputerUseSession,
    ComputerUseUpdate,
    performComputerUseTask,
    confirmComputerUseAction,
    cancelComputerUseSession,
    sendComputerUseCommand,
} from '../services/geminiService';

interface ComputerUseViewerProps {
    goal: string;
    initialUrl?: string;
    isDarkMode: boolean;
    existingSessionId?: string; // If provided, send command to this session instead of creating new
    onComplete?: (result: string) => void;
    onCancel?: () => void;
    onError?: (error: string) => void;
    onSessionCreated?: (sessionId: string) => void; // Called when a new session is created
}

export const ComputerUseViewer: React.FC<ComputerUseViewerProps> = ({
    goal,
    initialUrl,
    isDarkMode,
    existingSessionId,
    onComplete,
    onCancel,
    onError,
    onSessionCreated,
}) => {
    const [session, setSession] = useState<ComputerUseSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const pollingRef = useRef<boolean>(true);

    // Handle session updates
    const handleUpdate = useCallback((update: ComputerUseUpdate) => {
        setSession(update.session);

        if (update.type === 'complete') {
            onComplete?.(update.session.finalResult || 'Task completed');
            pollingRef.current = false;
        } else if (update.type === 'error') {
            const errorMsg = update.session.error || 'An error occurred';
            setError(errorMsg);
            onError?.(errorMsg);
            pollingRef.current = false;
        }
    }, [onComplete, onError]);

    // Start the session or send command to existing session
    useEffect(() => {
        let mounted = true;
        pollingRef.current = true;

        const startSession = async () => {
            try {
                setIsLoading(true);
                setError(null);

                let result: ComputerUseSession;

                if (existingSessionId) {
                    // Reuse existing session - send command
                    console.log('[ComputerUseViewer] Sending command to existing session:', existingSessionId);
                    result = await sendComputerUseCommand(existingSessionId, goal);
                } else {
                    // Create new session
                    console.log('[ComputerUseViewer] Creating new session for goal:', goal);
                    result = await performComputerUseTask(goal, initialUrl, (update) => {
                        if (mounted) handleUpdate(update);
                    });
                    // Notify parent about new session
                    if (result.id) {
                        onSessionCreated?.(result.id);
                    }
                }

                if (mounted) {
                    setSession(result);
                    setIsLoading(false);
                }
            } catch (err: any) {
                if (mounted) {
                    const errorMsg = err.message || 'Failed to start browser automation';
                    setError(errorMsg);
                    setIsLoading(false);
                    onError?.(errorMsg);
                }
            }
        };

        startSession();

        return () => {
            mounted = false;
            pollingRef.current = false;
        };
    }, [goal, initialUrl, existingSessionId, handleUpdate, onError, onSessionCreated]);

    // Handle confirmation
    const handleConfirm = async (confirmed: boolean) => {
        if (!session?.id) return;

        try {
            setIsLoading(true);
            const updatedSession = await confirmComputerUseAction(session.id, confirmed);
            setSession({ ...session, ...updatedSession });

            if (!confirmed) {
                onCancel?.();
            }
        } catch (err: any) {
            setError(err.message || 'Failed to process confirmation');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle cancel
    const handleCancel = async () => {
        if (!session?.id) return;

        try {
            await cancelComputerUseSession(session.id);
            onCancel?.();
        } catch (err: any) {
            console.error('Failed to cancel session:', err);
        }
    };

    // Listen for iframe disconnect
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data === 'browserbase-disconnected') {
                console.log('Browser session disconnected');
                pollingRef.current = false;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const isTerminal = ['completed', 'failed', 'cancelled'].includes(session?.status || '');

    return (
        <div
            className={`rounded-xl border overflow-hidden w-full max-w-full ${isDarkMode ? 'bg-[#1a1a1c] border-[#3d3d3f]/50' : 'bg-white border-gray-200'
                }`}
            style={{ overflowX: 'hidden' }}
        >
            {/* Header */}
            <div
                className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-[#3d3d3f]/50' : 'border-gray-200'
                    }`}
            >
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                    </div>
                    <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        🤖 Browser Automation
                    </span>
                    {session && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${session.status === 'completed'
                            ? 'bg-green-500/20 text-green-400'
                            : session.status === 'failed'
                                ? 'bg-red-500/20 text-red-400'
                                : session.status === 'awaiting_confirmation'
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-blue-500/20 text-blue-400'
                            }`}>
                            {session.status.replace('_', ' ')}
                        </span>
                    )}
                </div>

                {!isTerminal && (
                    <button
                        onClick={handleCancel}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${isDarkMode
                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                            : 'bg-red-100 text-red-600 hover:bg-red-200'
                            }`}
                    >
                        Stop
                    </button>
                )}
            </div>

            {/* Live View iframe - mobile aspect ratio 360:800 = 9:20 */}
            <div className="relative w-full" style={{ aspectRatio: '9/20', maxHeight: '70vh' }}>
                {session?.liveViewUrl ? (
                    <iframe
                        ref={iframeRef}
                        src={session.liveViewUrl}
                        sandbox="allow-same-origin allow-scripts"
                        allow="clipboard-read; clipboard-write"
                        className="w-full h-full border-0"
                        style={{ pointerEvents: session.status === 'awaiting_confirmation' ? 'none' : 'auto' }}
                    />
                ) : session?.screenshotBase64 ? (
                    <img
                        src={`data:image/png;base64,${session.screenshotBase64}`}
                        alt="Browser screenshot"
                        className="w-full h-full object-contain"
                    />
                ) : (
                    <div className={`flex items-center justify-center h-full ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-100'
                        }`}>
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    Starting browser session...
                                </span>
                            </div>
                        ) : error ? (
                            <div className="text-center p-4">
                                <div className="text-red-500 text-3xl mb-2">⚠️</div>
                                <p className={isDarkMode ? 'text-red-400' : 'text-red-600'}>{error}</p>
                            </div>
                        ) : null}
                    </div>
                )}

                {/* Safety Confirmation Modal */}
                {session?.status === 'awaiting_confirmation' && session.pendingAction && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div
                            className={`max-w-md w-full mx-4 p-6 rounded-xl shadow-2xl ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-white'
                                }`}
                        >
                            <div className="text-amber-500 text-3xl mb-3">⚠️</div>
                            <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>
                                Action Requires Confirmation
                            </h3>
                            <p className={`mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {session.pendingAction.safetyDecision?.explanation ||
                                    `The agent wants to perform: ${session.pendingAction.name}`}
                            </p>
                            <div className={`p-3 rounded-lg mb-4 text-sm font-mono ${isDarkMode ? 'bg-[#1a1a1c]' : 'bg-gray-100'
                                }`}>
                                <strong>{session.pendingAction.name}</strong>
                                <pre className="mt-1 text-xs overflow-auto">
                                    {JSON.stringify(session.pendingAction.args, null, 2)}
                                </pre>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => handleConfirm(false)}
                                    disabled={isLoading}
                                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${isDarkMode
                                        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                        }`}
                                >
                                    Deny
                                </button>
                                <button
                                    onClick={() => handleConfirm(true)}
                                    disabled={isLoading}
                                    className="flex-1 py-2 px-4 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                >
                                    {isLoading ? 'Processing...' : 'Allow'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer with status and actions */}
            <div
                className={`px-4 py-3 border-t ${isDarkMode ? 'border-[#3d3d3f]/50' : 'border-gray-200'
                    }`}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        {session?.currentUrl && (
                            <div className={`text-sm truncate max-w-md ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                📍 {session.currentUrl}
                            </div>
                        )}
                        {session?.turns !== undefined && (
                            <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                Turn {session.turns}/15
                            </div>
                        )}
                    </div>

                    {session?.replayUrl && (
                        <a
                            href={session.replayUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`text-xs hover:underline ${isDarkMode ? 'text-blue-400' : 'text-blue-600'
                                }`}
                        >
                            View Replay ↗
                        </a>
                    )}
                </div>

                {/* Agent Thoughts Log */}
                {session?.thoughts && session.thoughts.length > 0 && (
                    <div className={`mt-3 pt-3 border-t ${isDarkMode ? 'border-[#3d3d3f]/30' : 'border-gray-100'
                        }`}>
                        <details className="text-xs">
                            <summary className={`cursor-pointer font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                🧠 Agent Thoughts ({session.thoughts.length})
                            </summary>
                            <div className={`mt-2 space-y-2 max-h-48 overflow-auto ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                {session.thoughts.map((thought, i) => (
                                    <div
                                        key={i}
                                        className={`p-2 rounded text-xs ${isDarkMode ? 'bg-[#1a1a1c]' : 'bg-gray-50'}`}
                                    >
                                        <div className="flex items-start gap-2">
                                            <span className="text-purple-500 shrink-0">💭</span>
                                            <span className="whitespace-pre-wrap break-words">{thought}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </details>
                    </div>
                )}

                {/* Action Log */}
                {session?.actions && session.actions.length > 0 && (
                    <div className={`mt-3 pt-3 border-t ${isDarkMode ? 'border-[#3d3d3f]/30' : 'border-gray-100'
                        }`}>
                        <details className="text-xs">
                            <summary className={`cursor-pointer font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                ⚡ Actions ({session.actions.length})
                            </summary>
                            <div className={`mt-2 space-y-1 max-h-48 overflow-auto ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                {session.actions.map((action, i) => (
                                    <div
                                        key={i}
                                        className={`p-2 rounded text-xs ${isDarkMode ? 'bg-[#1a1a1c]' : 'bg-gray-50'}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={action.error ? 'text-red-500' : 'text-green-500'}>
                                                {action.error ? '✗' : '✓'}
                                            </span>
                                            <span className="font-mono font-medium">{action.name}</span>
                                            <span className="opacity-50 ml-auto">
                                                {new Date(action.timestamp).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        {action.args && Object.keys(action.args).length > 0 && (
                                            <div className={`mt-1 pl-5 font-mono text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                                {Object.entries(action.args).map(([key, value]) => (
                                                    <div key={key}>
                                                        <span className="opacity-60">{key}:</span>{' '}
                                                        <span>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {action.error && (
                                            <div className="mt-1 pl-5 text-red-400 text-[10px]">
                                                Error: {action.error}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </details>
                    </div>
                )}

                {/* Final Result */}
                {session?.finalResult && (
                    <div className={`mt-3 p-3 rounded-lg ${session.status === 'completed'
                        ? isDarkMode
                            ? 'bg-green-500/10 border border-green-500/20'
                            : 'bg-green-50 border border-green-200'
                        : isDarkMode
                            ? 'bg-red-500/10 border border-red-500/20'
                            : 'bg-red-50 border border-red-200'
                        }`}>
                        <p className={`text-sm ${session.status === 'completed'
                            ? isDarkMode ? 'text-green-400' : 'text-green-700'
                            : isDarkMode ? 'text-red-400' : 'text-red-700'
                            }`}>
                            {session.finalResult}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ComputerUseViewer;
