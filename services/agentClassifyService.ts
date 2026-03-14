/**
 * services/agentClassifyService.ts
 *
 * Browser-safe AI agent classification helpers.
 * This file must NOT import firebase-admin or any Node.js-only modules.
 * It is safe to import from components and frontend code.
 */

export interface ProjectAgent {
    name: string;
    expertise: string;
    approach: string;
}

const DEFAULT_AGENT: ProjectAgent = {
    name: 'Research Analyst',
    expertise: 'Deep investigation, source evaluation, and knowledge synthesis',
    approach: 'Methodical research with thorough analysis and evidence-based recommendations',
};

/**
 * Classify a project and return an appropriate AI agent persona.
 * Uses the /api/agent endpoint to keep firebase-admin server-side.
 */
export async function classifyProjectAgent(
    name: string,
    description: string
): Promise<ProjectAgent> {
    const projectName = (name || '').trim();
    const projectDesc = (description || '').trim();
    if (!projectName && !projectDesc) return { ...DEFAULT_AGENT };

    try {
        const res = await fetch('/api/agent?op=classify-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: projectName, description: projectDesc }),
        });
        if (!res.ok) return { ...DEFAULT_AGENT };
        const data = await res.json();
        if (data?.name && data?.expertise && data?.approach) {
            return data as ProjectAgent;
        }
    } catch (e) {
        console.warn('[agentClassifyService] classifyProjectAgent failed:', e);
    }
    return { ...DEFAULT_AGENT };
}

export function getAgentSystemPromptBlock(agent: ProjectAgent | undefined): string {
    if (!agent?.name) {
        return "You are an elite AI Research Assistant with deep knowledge of the user's project.";
    }
    return `You are **${agent.name}**, an elite AI assistant embedded in the user's project workspace.
Your Expertise: ${agent.expertise}
Your Approach: ${agent.approach}`;
}
