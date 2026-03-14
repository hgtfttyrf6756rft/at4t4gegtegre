import React, { useState } from 'react';
import { AdminLiveChat } from './AdminLiveChat';
import { SwarmCanvas } from './SwarmCanvas';

interface AdminAgentSwarmProps {
    adminId: string;
}

export const AdminAgentSwarm: React.FC<AdminAgentSwarmProps> = ({ adminId }) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    return (
        <div className="flex h-screen w-full bg-gray-950 overflow-hidden relative">

            {/* Main Canvas Area */}
            <div className={`flex-1 relative transition-all duration-300 ${isSidebarOpen ? 'mr-[350px]' : 'mr-0'}`}>
                {/* Header Overlay */}
                <div className="absolute top-0 left-0 right-0 p-4 z-10 flex justify-between items-center bg-gradient-to-b from-gray-950/80 to-transparent pointer-events-none">
                    <div className="pointer-events-auto flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight">Agent Swarm</h1>
                            <p className="text-xs text-indigo-300">Live Orchestration Dashboard</p>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="pointer-events-auto p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg shadow-lg border border-gray-700 transition"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            {isSidebarOpen ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            )}
                        </svg>
                    </button>
                </div>

                {/* The React Flow Canvas */}
                <SwarmCanvas adminId={adminId} />
            </div>

            {/* Live Chat Sidebar */}
            <div className={`fixed top-0 right-0 h-full bg-gray-900 border-l border-gray-800 transition-all duration-300 shadow-2xl z-20 ${isSidebarOpen ? 'w-[350px] translate-x-0' : 'w-[350px] translate-x-full'
                }`}>
                <AdminLiveChat adminId={adminId} />
            </div>

        </div>
    );
};
