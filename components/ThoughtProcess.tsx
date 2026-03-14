import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';

// Inline SVGs to avoid dependency on lucide-react
const BrainIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-pulse">
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
        <path d="M3.477 12.578c.254.332.564.634.922.898" />
        <path d="M19.601 13.476a4 4 0 0 0 .922-.898" />
    </svg>
);

const SparklesIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-indigo-600 dark:text-indigo-400">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        <path d="M5 3v4" />
        <path d="M9 3v4" />
        <path d="M5 9h4" />
    </svg>
);

const ChevronDownIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-indigo-500">
        <path d="m6 9 6 6 6-6" />
    </svg>
);

const ChevronUpIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-indigo-500">
        <path d="m18 15-6-6-6 6" />
    </svg>
);

interface ThoughtProcessProps {
    thought: string;
    isThinking: boolean;
    intent?: string;
}

export const ThoughtProcess: React.FC<ThoughtProcessProps> = ({
    thought,
    isThinking,
    intent
}) => {
    const [isExpanded, setIsExpanded] = useState(true);

    if (!thought && !isThinking) return null;

    return (
        <div className="mb-4 overflow-hidden transition-all duration-300">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-0 py-2 hover:opacity-80 transition-opacity"
            >
                <div className="flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-lg ${isThinking ? 'animate-pulse text-indigo-600' : 'text-indigo-600'}`}>
                        {isThinking ? (
                            <BrainIcon />
                        ) : (
                            <SparklesIcon />
                        )}
                    </div>
                    <div className="flex flex-col items-start text-left">
                        <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                            {isThinking ? 'Analyzing Request...' : 'Analysis Complete'}
                            {intent && !isThinking && (
                                <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-[10px] uppercase tracking-wider font-bold">
                                    {intent}
                                </span>
                            )}
                        </span>
                        <span className="text-xs text-indigo-600 dark:text-indigo-300 opacity-80">
                            {isThinking ? 'Formulating plan & checking tools' : 'Ready to execute'}
                        </span>
                    </div>
                </div>

                {isExpanded ? (
                    <ChevronUpIcon />
                ) : (
                    <ChevronDownIcon />
                )}
            </button>

            {isExpanded && (
                <div className="pl-10 pr-2 py-1 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-indigo-200 dark:scrollbar-thumb-indigo-800">
                    <div className="prose prose-xs dark:prose-invert max-w-none text-slate-600 dark:text-slate-300">
                        <ReactMarkdown
                            components={{
                                p: ({ node, ...props }) => <p className="mb-2 leading-relaxed" {...props} />,
                                ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-2 space-y-1" {...props} />,
                                li: ({ node, ...props }) => <li className="pl-1 marker:text-indigo-400" {...props} />,
                                strong: ({ node, ...props }) => <span className="font-semibold text-indigo-700 dark:text-indigo-300" {...props} />
                            }}
                        >
                            {thought || 'Preparing thoughts...'}
                        </ReactMarkdown>
                        {isThinking && (
                            <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-indigo-500 animate-blink" />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
