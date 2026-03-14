import React from 'react';

interface CursorData {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
    x: number;
    y: number;
    color: string;
    lastSeen: number;
}

interface CursorOverlayProps {
    cursors: CursorData[];
    containerRef?: React.RefObject<HTMLElement>;
}

const CursorOverlay: React.FC<CursorOverlayProps> = ({ cursors, containerRef }) => {
    if (cursors.length === 0) return null;

    return (
        <div
            className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden"
            style={{ isolation: 'isolate' }}
        >
            {cursors.map((cursor) => {
                const label = cursor.displayName || 'Anonymous';
                const timeSinceUpdate = Date.now() - cursor.lastSeen;
                const opacity = timeSinceUpdate > 3000 ? 0 : timeSinceUpdate > 2000 ? 0.5 : 1;

                return (
                    <div
                        key={cursor.uid}
                        className="absolute transition-all duration-150 ease-out"
                        style={{
                            left: cursor.x,
                            top: cursor.y,
                            opacity,
                        }}
                    >
                        {/* Cursor arrow SVG */}
                        <svg
                            width="16"
                            height="20"
                            viewBox="0 0 16 20"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="drop-shadow-md"
                        >
                            <path
                                d="M0.928711 0.514648L14.2168 10.0625H6.37989L0.928711 0.514648Z"
                                fill={cursor.color}
                                stroke="white"
                                strokeWidth="1"
                            />
                        </svg>

                        {/* Name label */}
                        <div
                            className="absolute left-4 top-4 px-2 py-0.5 rounded-md text-[11px] font-medium text-white whitespace-nowrap shadow-md"
                            style={{
                                backgroundColor: cursor.color,
                            }}
                        >
                            {label}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default CursorOverlay;
