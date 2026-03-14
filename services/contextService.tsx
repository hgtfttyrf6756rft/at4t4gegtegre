import { ResearchProject, SavedResearch, ProjectTask, ProjectNote, KnowledgeBaseFile, NoteNode, SessionConversation, AIThinkingLog, AssetCaption, ScheduledPost, SeoSearchResults, GoogleIntegrations, UserProfile, ProjectActivity } from '../types';
import { getAgentSystemPromptBlock } from './agentClassifyService';

export interface ProjectContext {
    projectSummary: string;
    researchContext: string;
    tasksContext: string;
    notesContext: string;
    knowledgeBaseContext: string;
    uploadedFilesContext: string;
    conversationsContext: string;
    aiThinkingContext: string;
    noteMapContext: string;
    assetCaptionsContext: string;
    generatedAssetsContext: string;
    scheduledPostsContext: string;
    seoSearchResultsContext: string;
    googleIntegrationsContext: string;
    activityLogContext: string;
    fullContext: string;
}

export interface AccountContext {
    accountSummary: string;
    fullContext: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: number;
    audioData?: string;
    thinking?: string;
}

const formatResearchSession = (session: SavedResearch, index: number): string => {
    // Handle invalid or incomplete sessions
    if (!session || !session.topic) {
        return `\n--- Research Session ${index + 1}: [Invalid Session Data] ---\n`;
    }

    const report = session.researchReport;
    let text = `\n--- Research Session ${index + 1}: "${session.topic}" ---\n`;
    text += `Date: ${new Date(session.timestamp).toLocaleDateString()}\n`;

    // Handle sessions without full report data
    if (!report) {
        text += `Note: Full report data not available for this session\n`;
        return text;
    }

    if (report.tldr) {
        text += `Summary: ${report.tldr}\n`;
    }

    if (report.keyPoints && report.keyPoints.length > 0) {
        text += `Key Points:\n`;
        report.keyPoints.forEach((point, i) => {
            text += `  ${i + 1}. ${point.title}: ${point.details.substring(0, 200)}${point.details.length > 200 ? '...' : ''}\n`;
        });
    }

    if (report.sources && report.sources.length > 0) {
        text += `Sources (${report.sources.length} total): `;
        text += report.sources.slice(0, 5).map(s => s.title).join(', ');
        if (report.sources.length > 5) text += `... and ${report.sources.length - 5} more`;
        text += '\n';
    }

    if (report.dynamicSections && report.dynamicSections.length > 0) {
        text += `Insights: ${report.dynamicSections.map(s => s.title).join(', ')}\n`;
    }

    return text;
};

const formatGeneratedAssets = (sessions: SavedResearch[]): string => {
    if (!sessions || sessions.length === 0) return '';

    const lines: string[] = [];

    sessions.forEach(session => {
        if (!session || !session.topic || !session.researchReport) return;
        const report = session.researchReport;
        const topicLabel = `"${session.topic}"`;

        // Blog posts
        if (report.blogPost && report.blogPost.title) {
            const subtitle = report.blogPost.subtitle ? ` – ${report.blogPost.subtitle}` : '';
            lines.push(`Blog for ${topicLabel}: "${report.blogPost.title}${subtitle}"`);
        }

        // Social campaigns
        if (report.socialCampaign && report.socialCampaign.posts && report.socialCampaign.posts.length > 0) {
            const postCount = report.socialCampaign.posts.length;
            const platforms = Array.from(new Set(report.socialCampaign.posts.map(p => p.platform))).join(', ');
            lines.push(`Social campaign for ${topicLabel}: ${postCount} post(s) across ${platforms}`);
        }

        // Images (header + slides)
        let imageCount = 0;
        if (report.headerImageUrl) imageCount += 1;
        if (report.slides && report.slides.length > 0) {
            report.slides.forEach(slide => {
                if (slide.imageUrl) imageCount += 1;
                if (slide.imageUrls && slide.imageUrls.length > 0) imageCount += slide.imageUrls.length;
            });
        }
        if (imageCount > 0) {
            lines.push(`Images for ${topicLabel}: ${imageCount} generated image asset(s) across hero and slides`);
        }

        // Websites
        const websites = session.websiteVersions || [];
        if (websites.length > 0) {
            const latest = websites.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
            const latestDesc = latest.description || 'Website experience';
            const latestDate = new Date(latest.timestamp).toLocaleDateString();
            lines.push(`Websites for ${topicLabel}: ${websites.length} version(s). Latest: "${latestDesc}" (created ${latestDate})`);
        }
    });

    if (lines.length === 0) return '';

    let text = '\n=== GENERATED ASSETS (IMAGES, BLOGS, WEBSITES, SOCIAL CAMPAIGNS) ===\n';
    lines.forEach(line => {
        text += `- ${line}\n`;
    });
    return text;
};

const formatTasks = (tasks: ProjectTask[]): string => {
    if (!tasks || tasks.length === 0) return '';

    const todoTasks = tasks.filter(t => t.status === 'todo');
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const doneTasks = tasks.filter(t => t.status === 'done');

    let text = '\n--- Project Tasks ---\n';

    if (inProgressTasks.length > 0) {
        text += 'In Progress:\n';
        inProgressTasks.forEach(t => {
            text += `  - [${t.priority.toUpperCase()}] ${t.title}${t.description ? `: ${t.description.substring(0, 100)}` : ''}\n`;
        });
    }

    if (todoTasks.length > 0) {
        text += 'To Do:\n';
        todoTasks.forEach(t => {
            text += `  - [${t.priority.toUpperCase()}] ${t.title}${t.description ? `: ${t.description.substring(0, 100)}` : ''}\n`;
        });
    }

    if (doneTasks.length > 0) {
        text += `Completed: ${doneTasks.length} tasks\n`;
    }

    return text;
};

const formatNotes = (notes: ProjectNote[]): string => {
    if (!notes || notes.length === 0) return '';

    let text = '\n--- Project Notes ---\n';

    const pinnedNotes = notes.filter(n => n.pinned);
    const regularNotes = notes.filter(n => !n.pinned);

    if (pinnedNotes.length > 0) {
        text += 'Pinned Notes:\n';
        pinnedNotes.forEach(n => {
            text += `  * ${n.title}: ${n.content.substring(0, 150)}${n.content.length > 150 ? '...' : ''}\n`;
        });
    }

    if (regularNotes.length > 0) {
        text += 'Recent Notes:\n';
        regularNotes.slice(0, 5).forEach(n => {
            text += `  - ${n.title}: ${n.content.substring(0, 100)}${n.content.length > 100 ? '...' : ''}\n`;
        });
        if (regularNotes.length > 5) {
            text += `  ... and ${regularNotes.length - 5} more notes\n`;
        }
    }

    return text;
};

const formatKnowledgeBase = (files: KnowledgeBaseFile[]): string => {
    if (!files || files.length === 0) return '';

    let text = '\n=== KNOWLEDGE BASE FILES ===\n';
    text += `You have access to ${files.length} uploaded file(s) with their extracted content:\n\n`;

    files.forEach((file, index) => {
        text += `--- File ${index + 1}: ${file.name} (${file.type}) ---\n`;
        if (file.summary) {
            text += `Summary: ${file.summary}\n`;
        }
        if (file.extractedText) {
            text += `Full Content:\n${file.extractedText}\n`;
        }
        text += '\n';
    });

    return text;
};

export const getKnowledgeBaseForResearch = (project: ResearchProject, researchTopic: string): string => {
    const projectFiles = project.knowledgeBase || [];

    if (projectFiles.length === 0) return '';

    let context = `\n=== PROJECT KNOWLEDGE BASE ===\n`;
    context += `The user has uploaded ${projectFiles.length} file(s) to the project "${project.name}" that may be relevant to this research on "${researchTopic}".\n`;
    context += `Use this information as background context and reference material:\n\n`;

    projectFiles.forEach((file, index) => {
        context += `### Document ${index + 1}: ${file.name}\n`;
        context += `Type: ${file.type}\n`;
        context += `Uploaded: ${new Date(file.uploadedAt).toLocaleDateString()}\n`;

        if (file.summary) {
            context += `AI Summary: ${file.summary}\n`;
        }

        if (file.extractedText) {
            const maxLength = 5000;
            const content = file.extractedText.length > maxLength
                ? file.extractedText.substring(0, maxLength) + '... [truncated]'
                : file.extractedText;
            context += `\nExtracted Content:\n${content}\n`;
        }

        context += '\n---\n\n';
    });

    context += `When conducting research, consider how the above documents relate to the topic and incorporate relevant information from them.\n`;

    return context;
};

const formatConversations = (sessions: SavedResearch[]): string => {
    const allConversations: { topic: string; conversations: SessionConversation[] }[] = [];

    sessions.forEach(session => {
        if (session && session.topic && session.conversations && session.conversations.length > 0) {
            allConversations.push({
                topic: session.topic,
                conversations: session.conversations
            });
        }
    });

    if (allConversations.length === 0) return '';

    let text = '\n=== CONVERSATION HISTORY ===\n';

    allConversations.forEach(({ topic, conversations }) => {
        text += `\n--- Conversations from "${topic}" ---\n`;
        conversations.forEach(conv => {
            text += `[${conv.mode.toUpperCase()} Session - ${new Date(conv.startedAt).toLocaleString()}]\n`;
            conv.messages.slice(-10).forEach(msg => {
                const role = msg.role === 'user' ? 'User' : 'AI';
                text += `  ${role}: ${msg.text.substring(0, 200)}${msg.text.length > 200 ? '...' : ''}\n`;
                if (msg.thinking) {
                    text += `    (AI Reasoning: ${msg.thinking.substring(0, 100)}...)\n`;
                }
            });
        });
    });

    return text;
};

const formatAIThinking = (sessions: SavedResearch[]): string => {
    const allThinking: { topic: string; logs: AIThinkingLog[] }[] = [];

    sessions.forEach(session => {
        if (session && session.topic && session.aiThinking && session.aiThinking.length > 0) {
            allThinking.push({
                topic: session.topic,
                logs: session.aiThinking
            });
        }
    });

    if (allThinking.length === 0) return '';

    let text = '\n=== AI REASONING & THOUGHT PROCESS ===\n';

    allThinking.forEach(({ topic, logs }) => {
        text += `\n--- AI Thinking from "${topic}" ---\n`;
        logs.slice(-20).forEach(log => {
            text += `[${new Date(log.timestamp).toLocaleString()}] ${log.thought}\n`;
            if (log.context) {
                text += `  Context: ${log.context.substring(0, 100)}...\n`;
            }
            if (log.toolsUsed && log.toolsUsed.length > 0) {
                text += `  Tools: ${log.toolsUsed.join(', ')}\n`;
            }
        });
    });

    return text;
};

const formatNoteMapNodes = (sessions: SavedResearch[]): string => {
    const allNodes: { topic: string; nodes: NoteNode[] }[] = [];

    sessions.forEach(session => {
        if (session && session.topic && session.noteMapState && session.noteMapState.length > 0) {
            allNodes.push({
                topic: session.topic,
                nodes: session.noteMapState
            });
        }
    });

    if (allNodes.length === 0) return '';

    let text = '\n=== NOTE MAP NODES ===\n';

    allNodes.forEach(({ topic, nodes }) => {
        text += `\n--- Note Map from "${topic}" (${nodes.length} nodes) ---\n`;
        nodes.forEach(node => {
            text += `  * ${node.title}`;
            if (node.content) {
                text += `: ${node.content.substring(0, 150)}${node.content.length > 150 ? '...' : ''}`;
            }
            text += '\n';
            if (node.connections && node.connections.length > 0) {
                const connectedTitles = node.connections
                    .map(connId => nodes.find(n => n.id === connId)?.title)
                    .filter(Boolean);
                if (connectedTitles.length > 0) {
                    text += `    Connected to: ${connectedTitles.join(', ')}\n`;
                }
            }
        });
    });

    return text;
};

const formatAssetCaptions = (sessions: SavedResearch[]): string => {
    const allCaptions: { topic: string; captions: AssetCaption[] }[] = [];

    sessions.forEach(session => {
        if (session && session.topic && session.assetCaptions && session.assetCaptions.length > 0) {
            allCaptions.push({
                topic: session.topic,
                captions: session.assetCaptions
            });
        }
    });

    if (allCaptions.length === 0) return '';

    let text = '\n=== ASSET CAPTIONS & DESCRIPTIONS ===\n';

    allCaptions.forEach(({ topic, captions }) => {
        text += `\n--- Assets from "${topic}" ---\n`;
        captions.forEach(caption => {
            const badge = caption.aiGenerated ? '[AI]' : '[User]';
            text += `  ${badge} ${caption.assetType}: ${caption.caption}\n`;
        });
    });

    return text;
};

const formatScheduledPosts = (posts: ScheduledPost[]): string => {
    if (!posts || posts.length === 0) return '';

    let text = '\n=== SCHEDULED SOCIAL MEDIA POSTS ===\n';
    text += `You have ${posts.length} scheduled post(s) pending:\n\n`;

    const sortedPosts = [...posts].sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));

    sortedPosts.forEach((post, index) => {
        const scheduledDate = post.scheduledAt
            ? new Date(post.scheduledAt).toLocaleString()
            : 'Not scheduled';
        const platformList = (post.platforms || []).join(', ') || 'No platforms';

        text += `${index + 1}. [${post.status?.toUpperCase() || 'PENDING'}] Scheduled for: ${scheduledDate}\n`;
        text += `   Platforms: ${platformList}\n`;
        if (post.textContent) {
            const preview = post.textContent.length > 150
                ? post.textContent.substring(0, 150) + '...'
                : post.textContent;
            text += `   Content: ${preview}\n`;
        }
        text += '\n';
    });

    return text;
};

const formatActivityLog = (activities?: ProjectActivity[], label = 'RECENT PROJECT ACTIVITY'): string => {
    if (!activities || activities.length === 0) return '';

    let text = `\n=== ${label} ===\n`;
    text += 'Timeline of recent activities (newest first):\n\n';

    // Sort by timestamp descending (newest first) and limit to last 30
    const sorted = [...activities].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);

    sorted.forEach(activity => {
        const date = new Date(activity.timestamp).toLocaleString();
        const actor = activity.actorName || 'Someone';
        const tags = (activity.metadata?.tags as string[] | undefined);
        const tagStr = tags && tags.length > 0 ? ` [${tags.join(', ')}]` : '';
        text += `- [${date}] ${actor}: ${activity.description}${tagStr}\n`;
    });

    return text;
};

// Aggregates activities across multiple projects (for HomeLiveAssistant)
const formatAllProjectsActivity = (
    activitiesByProjectId: Record<string, ProjectActivity[]>,
    projectNames: Record<string, string>
): string => {
    const all: (ProjectActivity & { projectName: string })[] = [];
    Object.entries(activitiesByProjectId).forEach(([pid, acts]) => {
        acts.forEach(a => all.push({ ...a, projectName: projectNames[pid] || pid }));
    });
    if (all.length === 0) return '';

    const sorted = all.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);

    let text = '\n=== RECENT ACTIVITY ACROSS ALL PROJECTS ===\n';
    text += 'Timeline across all your projects (newest first):\n\n';
    sorted.forEach(activity => {
        const date = new Date(activity.timestamp).toLocaleString();
        const actor = activity.actorName || 'Someone';
        const tags = (activity.metadata?.tags as string[] | undefined);
        const tagStr = tags && tags.length > 0 ? ` [${tags.join(', ')}]` : '';
        text += `- [${date}] [${activity.projectName}] ${actor}: ${activity.description}${tagStr}\n`;
    });
    return text;
};

const formatSeoSearchResults = (seoResults: SeoSearchResults | undefined): string => {
    if (!seoResults) return '';

    const sections: string[] = [];

    // SEO Keyword Analysis
    if (seoResults.seoAnalysis?.keyword) {
        let text = '--- SEO Keyword Analysis ---\n';
        text += `Keyword: "${seoResults.seoAnalysis.keyword}"\n`;
        text += `Location: ${seoResults.seoAnalysis.location}\n`;
        if (seoResults.seoAnalysis.advice) {
            text += `AI Advice: ${seoResults.seoAnalysis.advice.substring(0, 500)}...\n`;
        }
        if (seoResults.seoAnalysis.data) {
            const data = seoResults.seoAnalysis.data;
            if (data.searchVolume) text += `Search Volume: ${data.searchVolume}\n`;
            if (data.cpc) text += `CPC: $${data.cpc}\n`;
            if (data.competition) text += `Competition: ${data.competition}\n`;
            if (Array.isArray(data.relatedKeywords)) {
                text += `Related Keywords: ${data.relatedKeywords.slice(0, 5).join(', ')}\n`;
            }
        }
        sections.push(text);
    }

    // Instagram Hashtag Research
    if (seoResults.igHashtagResearch?.query) {
        let text = '--- Instagram Hashtag Research ---\n';
        text += `Hashtag: #${seoResults.igHashtagResearch.query}\n`;
        if (seoResults.igHashtagResearch.hashtagId) {
            text += `Hashtag ID: ${seoResults.igHashtagResearch.hashtagId}\n`;
        }
        const topCount = (seoResults.igHashtagResearch.topMedia || []).length;
        const recentCount = (seoResults.igHashtagResearch.recentMedia || []).length;
        text += `Top Media: ${topCount} posts found\n`;
        text += `Recent Media: ${recentCount} posts found\n`;
        sections.push(text);
    }

    // Instagram Business Discovery
    if (seoResults.igBusinessDiscovery?.username) {
        let text = '--- Instagram Business Discovery ---\n';
        text += `Username: @${seoResults.igBusinessDiscovery.username}\n`;
        const result = seoResults.igBusinessDiscovery.result;
        if (result) {
            if (result.name) text += `Name: ${result.name}\n`;
            if (result.followers_count) text += `Followers: ${result.followers_count.toLocaleString()}\n`;
            if (result.media_count) text += `Posts: ${result.media_count.toLocaleString()}\n`;
            if (result.biography) text += `Bio: ${result.biography.substring(0, 150)}...\n`;
        }
        sections.push(text);
    }

    // X (Twitter) Search
    if (seoResults.xSearch?.query) {
        let text = '--- X (Twitter) Search ---\n';
        text += `Mode: ${seoResults.xSearch.mode}\n`;
        text += `Query: "${seoResults.xSearch.query}"\n`;
        const results = seoResults.xSearch.results;
        if (results?.data && Array.isArray(results.data)) {
            text += `Results: ${results.data.length} ${seoResults.xSearch.mode} found\n`;
        }
        sections.push(text);
    }

    // Ad Targeting Search
    if (seoResults.adTargetingSearch?.results?.length) {
        let text = '--- Ad Targeting Search ---\n';
        text += `Type: ${seoResults.adTargetingSearch.type}\n`;
        if (seoResults.adTargetingSearch.query) {
            text += `Query: "${seoResults.adTargetingSearch.query}"\n`;
        }
        text += `Results: ${seoResults.adTargetingSearch.results.length} targeting options found\n`;
        const preview = seoResults.adTargetingSearch.results.slice(0, 5);
        preview.forEach((r: any, i: number) => {
            text += `  ${i + 1}. ${r.name || r.key || JSON.stringify(r).substring(0, 50)}\n`;
        });
        sections.push(text);
    }

    if (sections.length === 0) return '';

    return '\n=== SEO TAB SEARCH RESULTS ===\n' + sections.join('\n');
};

const formatGoogleIntegrations = (integrations: GoogleIntegrations | undefined): string => {
    if (!integrations) return '';

    const sections: string[] = [];

    // Google Drive Files
    if (integrations.driveFiles && integrations.driveFiles.length > 0) {
        let text = '--- Google Drive Imported Files ---\n';
        text += `You have ${integrations.driveFiles.length} file(s) imported from Google Drive:\n`;
        integrations.driveFiles.forEach((file, i) => {
            const typeLabel = file.mimeType?.includes('spreadsheet') ? 'Sheet' :
                file.mimeType?.includes('document') ? 'Doc' :
                    file.mimeType?.includes('presentation') ? 'Slides' :
                        file.mimeType?.includes('folder') ? 'Folder' : 'File';
            text += `  ${i + 1}. [${typeLabel}] ${file.name}`;
            if (file.modifiedTime) {
                const modified = new Date(file.modifiedTime).toLocaleDateString();
                text += ` (modified: ${modified})`;
            }
            text += '\n';
        });
        sections.push(text);
    }

    // Google Calendar Events
    if (integrations.calendarEvents && integrations.calendarEvents.length > 0) {
        let text = '--- Google Calendar Events ---\n';
        text += `You have ${integrations.calendarEvents.length} calendar event(s):\n`;

        const sortedEvents = [...integrations.calendarEvents].sort((a, b) => {
            const aTime = a.start?.dateTime || a.start?.date || '';
            const bTime = b.start?.dateTime || b.start?.date || '';
            return aTime.localeCompare(bTime);
        });

        sortedEvents.slice(0, 20).forEach((event, i) => {
            const startTime = event.start?.dateTime
                ? new Date(event.start.dateTime).toLocaleString()
                : event.start?.date || 'No date';
            text += `  ${i + 1}. ${event.summary || 'Untitled Event'} - ${startTime}`;
            if (event.location) {
                text += ` @ ${event.location}`;
            }
            text += '\n';
            if (event.description) {
                text += `     Description: ${event.description.substring(0, 100)}...\n`;
            }
        });

        if (integrations.calendarEvents.length > 20) {
            text += `  ... and ${integrations.calendarEvents.length - 20} more events\n`;
        }
        sections.push(text);
    }

    // Synced Google Docs content
    if (integrations.syncedDocs && integrations.syncedDocs.length > 0) {
        let text = '--- Synced Google Docs ---\n';
        text += `You have ${integrations.syncedDocs.length} Google Doc(s) synced with their current content:\n`;
        integrations.syncedDocs.forEach((doc, i) => {
            text += `\n${i + 1}. "${doc.title}" (Last synced: ${new Date(doc.lastSyncedAt).toLocaleString()})\n`;
            const truncated = doc.text.length > 3000 ? doc.text.substring(0, 3000) + '...[truncated]' : doc.text;
            text += `Content:\n${truncated}\n`;
        });
        sections.push(text);
    }

    // Synced Google Sheets content
    if (integrations.syncedSheets && integrations.syncedSheets.length > 0) {
        let text = '--- Synced Google Sheets ---\n';
        text += `You have ${integrations.syncedSheets.length} Google Sheet(s) synced with their current data:\n`;
        integrations.syncedSheets.forEach((sheet, i) => {
            text += `\n${i + 1}. "${sheet.title}" - Tab: "${sheet.sheetTitle}" (Last synced: ${new Date(sheet.lastSyncedAt).toLocaleString()})\n`;
            text += `Columns: ${sheet.columns.join(' | ')}\n`;
            text += `Data (${sheet.rows.length} rows):\n`;
            sheet.rows.slice(0, 50).forEach((row, ri) => {
                text += `  Row ${ri + 1}: ${row.join(' | ')}\n`;
            });
            if (sheet.rows.length > 50) {
                text += `  ...[${sheet.rows.length - 50} more rows not shown]\n`;
            }
        });
        sections.push(text);
    }

    if (sections.length === 0) return '';

    return '\n=== GOOGLE INTEGRATIONS ===\n' + sections.join('\n');
};

const formatUploadedFiles = (uploadedFiles: any[]): string => {
    if (!uploadedFiles || uploadedFiles.length === 0) return '';

    let text = '\n=== UPLOADED DATA FILES ===\n';
    text += `The user has uploaded ${uploadedFiles.length} file(s) for you to reference:\n`;

    uploadedFiles.forEach((file, index) => {
        const fileType = file.mimeType.split('/')[0]; // image, video, audio, application
        text += `\n${index + 1}. ${file.displayName}\n`;
        text += `   Type: ${file.mimeType} (${fileType})\n`;
        text += `   Size: ${(file.sizeBytes / 1024 / 1024).toFixed(2)} MB\n`;
        text += `   URI: ${file.uri}\n`;

        if (fileType === 'image') {
            text += `   Note: You can analyze this image's content, describe what you see, extract text, etc.\n`;
        } else if (fileType === 'video') {
            text += `   Note: You can analyze this video, describe scenes, extract audio/speech, etc.\n`;
        } else if (fileType === 'audio') {
            text += `   Note: You can transcribe this audio, identify speakers, extract information, etc.\n`;
        } else if (file.mimeType.includes('pdf') || file.mimeType.includes('document')) {
            text += `   Note: You can extract and analyze text content from this document.\n`;
        }
    });

    text += '\nIMPORTANT: These files are available for you to reference. When the user asks about them, you can analyze their content directly.\n';

    return text;
};

export const buildProjectContext = (project: ResearchProject, injectedActivities?: ProjectActivity[]): ProjectContext => {
    const sessions = project.researchSessions || [];

    const projectSummary = `
=== PROJECT: "${project.name}" ===
Description: ${project.description || 'No description provided'}
Created: ${new Date(project.createdAt).toLocaleDateString()}
Last Updated: ${new Date(project.lastModified).toLocaleDateString()}
Research Sessions: ${sessions.length}
Tasks: ${project.tasks?.length || 0}
Notes: ${project.notes?.length || 0}
Knowledge Base Files: ${project.knowledgeBase?.length || 0}
Uploaded Data Files: ${project.uploadedFiles?.length || 0}
`;

    let researchContext = '';
    if (sessions.length > 0) {
        researchContext = '\n=== RESEARCH KNOWLEDGE BASE ===\n';
        researchContext += `Total ${sessions.length} research sessions covering various topics:\n`;

        sessions.forEach((session, index) => {
            researchContext += formatResearchSession(session, index);
        });
    }

    const tasksContext = formatTasks(project.tasks || []);
    const notesContext = formatNotes(project.notes || []);
    const knowledgeBaseContext = formatKnowledgeBase(project.knowledgeBase || []);
    const uploadedFilesContext = formatUploadedFiles(project.uploadedFiles || []);
    const conversationsContext = formatConversations(sessions);
    const aiThinkingContext = formatAIThinking(sessions);
    const noteMapContext = formatNoteMapNodes(sessions);
    const assetCaptionsContext = formatAssetCaptions(sessions);
    const generatedAssetsContext = formatGeneratedAssets(sessions);
    const scheduledPostsContext = formatScheduledPosts(project.scheduledPosts || []);
    const seoSearchResultsContext = formatSeoSearchResults(project.seoSearchResults);
    const googleIntegrationsContext = formatGoogleIntegrations(project.googleIntegrations);
    const activityLogContext = formatActivityLog(injectedActivities ?? project.activities);

    const fullContext = `${projectSummary}${researchContext}${noteMapContext}${conversationsContext}${aiThinkingContext}${assetCaptionsContext}${generatedAssetsContext}${uploadedFilesContext}${tasksContext}${notesContext}${knowledgeBaseContext}${scheduledPostsContext}${seoSearchResultsContext}${googleIntegrationsContext}${activityLogContext}`;

    return {
        projectSummary,
        researchContext,
        tasksContext,
        notesContext,
        knowledgeBaseContext,
        uploadedFilesContext,
        conversationsContext,
        aiThinkingContext,
        noteMapContext,
        assetCaptionsContext,
        generatedAssetsContext,
        scheduledPostsContext,
        seoSearchResultsContext,
        googleIntegrationsContext,
        activityLogContext,
        fullContext
    };
};

export const buildAccountContext = (projects: ResearchProject[], activitiesByProjectId?: Record<string, ProjectActivity[]>): AccountContext => {
    const projectCount = projects.length;
    const totalResearchSessions = projects.reduce((acc, p) => acc + (p.researchSessions?.length || 0), 0);
    const totalTasks = projects.reduce((acc, p) => acc + (p.tasks?.length || 0), 0);
    const totalNotes = projects.reduce((acc, p) => acc + (p.notes?.length || 0), 0);
    const totalKnowledgeFiles = projects.reduce((acc, p) => acc + (p.knowledgeBase?.length || 0), 0);
    const totalUploadedFiles = projects.reduce((acc, p) => acc + (p.uploadedFiles?.length || 0), 0);

    const accountSummary = `=== ACCOUNT PROJECT OVERVIEW ===
Total Projects: ${projectCount}
Total Research Sessions: ${totalResearchSessions}
Total Tasks: ${totalTasks}
Total Notes: ${totalNotes}
Total Knowledge Base Files: ${totalKnowledgeFiles}
Total Uploaded Data Files: ${totalUploadedFiles}
`;

    let combinedContext = accountSummary;
    projects.forEach(project => {
        const injected = activitiesByProjectId?.[project.id];
        const ctx = buildProjectContext(project, injected);
        combinedContext += `
========================================
${ctx.fullContext}
`;
    });

    // Guard against extremely large prompts while still keeping cross-project visibility.
    const MAX_LENGTH = 60000;
    if (combinedContext.length > MAX_LENGTH) {
        combinedContext = combinedContext.slice(0, MAX_LENGTH) + '\n...[truncated account context]';
    }

    return {
        accountSummary,
        fullContext: combinedContext,
    };
};

const formatUserProfileContext = (profile: UserProfile | null | undefined): string => {
    if (!profile) return '';
    let text = `\n=== USER PROFILE & BRAND VOICE ===\n`;
    if (profile.displayName) text += `User Name: ${profile.displayName}\n`;
    if (profile.description) text += `Brand Voice/Bio: ${profile.description}\n`;
    if (profile.photoURL) text += `Profile Picture / Logo URL: ${profile.photoURL}\n(Use this URL for image generation tasks when the user refers to "my logo" or "my profile picture")\n`;
    text += `\nINSTRUCTION: Please personalize your responses to align with the user's brand voice and bio provided above. Adoption of this persona is critical.\n`;
    return text;
};

export const buildResearchSessionContext = (session: SavedResearch): string => {
    return formatResearchSession(session, 0);
};

export const getProjectSystemInstruction = (project: ResearchProject, mode: 'voice' | 'chat' = 'chat', userProfile?: UserProfile | null, activities?: ProjectActivity[]): string => {
    const context = buildProjectContext(project, activities);
    const userContext = formatUserProfileContext(userProfile);

    const modeSpecificInstructions = mode === 'voice'
        ? `You are speaking with the user via real-time audio. Keep responses concise and conversational. Avoid very long responses - aim for 2-3 sentences unless the user asks for detail.`
        : `You are chatting with the user via text. You can provide more detailed responses when helpful.`;

    const agentIdentity = getAgentSystemPromptBlock(project.agent);

    return `${agentIdentity}

${userContext}

${modeSpecificInstructions}

YOUR ROLE:
- You have complete knowledge of this project and all its research sessions
- Help the user synthesize insights across ALL research topics
- Answer questions using the accumulated knowledge base
- Suggest connections between different research findings
- Help prioritize tasks and identify gaps in research

CAPABILITIES:
1. Answer questions about any research topic in the project
2. Compare and contrast findings from different research sessions
3. Identify patterns and insights across the research
4. Suggest next steps based on current progress
5. Help with task management and note-taking
6. Generate images, videos, blogs, websites, podcasts, and tables
7. Run SEO keyword analysis
8. Post content to social media (Facebook, Instagram, X/Twitter, TikTok, YouTube, LinkedIn) using the post_to_social function - ALWAYS use this function when the user asks to post, share, tweet, or publish content to any social platform
9. Schedule social media posts for later using the schedule_post function

INTELLIGENT QUERY HANDLING:
When the user asks questions, be SMART about finding answers:

1. INFER CONTEXT FROM PROJECT:
   - If the question is vague (e.g., "market size", "competitors", "trends"), look at the project name, description, and research sessions to understand WHAT industry/topic the user is asking about
   - Example: Project is about "AI Chatbots" and user asks "market size in 2025" → Research AI chatbot market size in 2025
   - NEVER immediately say "I couldn't find information" - always try to infer what they mean first

2. USE MULTIPLE SOURCES (IN THIS ORDER):
   a) PROJECT CONTEXT: Check if research sessions, notes, or knowledge base already have the answer
   b) WEB SEARCH: For general knowledge, current data, market statistics, industry trends, news, etc.
   c) FILE SEARCH: Only for searching specific content INSIDE uploaded documents (PDFs, presentations, etc.)
   
3. BE PROACTIVE, NOT PASSIVE:
   - If you can infer what the user means from project context, DO IT without asking for clarification
   - Combine sources: "Based on your project about [topic from context], here's the market size I found via web search..."
   - Only ask for clarification if it's truly impossible to help (e.g., "market size" but project has no clear industry/topic)
   
4. HANDLE AMBIGUOUS QUESTIONS SMARTLY:
   - DON'T say: "I couldn't find information about market size in the documents"
   - DO say: "Based on your project about [inferred topic], let me search for the market size..." then use web search
   - If truly ambiguous, ask: "I see your project is about [topic]. Are you asking about the [topic] market size, or a different market?"

IMPORTANT - WHERE TO FIND PROJECT DATA:
The PROJECT CONTEXT section below contains ALL project data including:
- Research sessions (topics, findings, summaries)
- Tasks and notes
- Knowledge base items
- Scheduled posts and SEO data
USE THIS CONTEXT DIRECTLY to answer questions about the project, research sessions, tasks, notes, etc.

FILE SEARCH (FOR UPLOADED DOCUMENTS ONLY):
File Search is ONLY for searching the content INSIDE uploaded files (PDFs, docs, etc.).
- It does NOT contain research sessions, tasks, or notes - those are in the PROJECT CONTEXT above.
- Use File Search only when the user asks about specific uploaded document contents.

BROWSER AUTOMATION (Pro Feature):
CRITICAL CONTEXT AWARENESS - READ THIS FIRST:
Before invoking ANY tool (especially browser automation), ALWAYS consider the conversation history:
- If YOUR previous message ASKED the user for input (e.g., "What caption would you like?", "What subject line?", "Describe the product"), then the user's reply is CONTENT/DATA, NOT a new instruction.
- NEVER trigger browser automation just because the user's reply contains keywords like "automation", "browse", "scrape", "browser", etc., when they are clearly providing a caption, description, title, or other requested content.
- Only trigger browser automation when the user is INITIATING A NEW REQUEST that explicitly requires live web interaction, NOT when they are responding to your question.

You have the ability to control a web browser for tasks that require real-time interaction with websites. When the user asks you to:
- Search for products, prices, or compare items on shopping sites
- Check current/live data (stock prices, weather, news, availability)
- Fill out forms or submit applications
- Navigate websites and extract real-time information
- Any task that explicitly mentions "use the browser", "automate", or requires live web interaction

You should acknowledge that you CAN do this and explain that you will start the browser automation. Example responses:
- "I can help with that! Let me open the browser and search for iPhones on BestBuy..."
- "I'll automate that for you. Starting browser automation to check pricing..."

The browser automation will appear inline in the chat with a live view of the browser session.

PROJECT CONTEXT:
${context.fullContext}

Remember: The PROJECT CONTEXT above contains ALL research sessions, tasks, notes, and other project data. Use it directly to answer user questions about the project.`;
};

export const getAccountSystemInstruction = (
    projects: ResearchProject[],
    mode: 'voice' | 'chat' = 'chat',
    scheduledPosts: ScheduledPost[] = [],
    userProfile?: UserProfile | null,
    social?: any,
    activitiesByProjectId?: Record<string, ProjectActivity[]>
): string => {
    const context = buildAccountContext(projects, activitiesByProjectId);
    const projectNames = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const allActivityContext = activitiesByProjectId
        ? formatAllProjectsActivity(activitiesByProjectId, projectNames)
        : '';
    const scheduledPostsContext = formatScheduledPosts(scheduledPosts);
    const userContext = formatUserProfileContext(userProfile);

    const modeSpecificInstructions = mode === 'voice'
        ? `You are speaking with the user via real-time audio. Keep responses concise and conversational. Avoid very long responses - aim for 2-3 sentences unless the user asks for detail.`
        : `You are chatting with the user via text. You can provide more detailed responses when helpful.`;

    const socialStatus = social ? `
=== SOCIAL MEDIA CONNECTION STATUS (REAL-TIME) ===
Facebook/Instagram: ${social.facebookConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}
X (Twitter): ${social.xConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}
LinkedIn: ${social.linkedinConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}
YouTube: ${social.youtubeConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}
TikTok: ${social.tiktokConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}
${social.facebookConnected && social.igAccounts?.length > 0 ? `\nConnected Instagram Accounts: ${social.igAccounts.map((a: any) => `@${a.username}`).join(', ')}` : ''}

WHEN A USER ASKS TO POST TO SOCIAL MEDIA:
1. CHECK STATUS: First, look at the CONNECTION STATUS above.
2. DISCONNECTED: If the requested platform is ❌ DISCONNECTED, DO NOT try to post. Instead, tell the user: "Your [Platform] account is not connected yet. Please go to a project's Social tab to connect it."
3. CONNECTED: If the platform is ✅ CONNECTED, you MUST use the \`post_to_social\` tool to make the post.
4. CONFIRMATION: Once the tool returns success, confirm the post is live.
` : '';

    return `You are an elite AI Research Assistant with deep knowledge of the user's entire workspace across all projects.

${userContext}

${modeSpecificInstructions}
${socialStatus}

YOUR ROLE:
- You have visibility into every research project the user has created
- You can see all scheduled social media posts across all projects
- Synthesize insights across multiple projects, not just one
- Help compare and contrast different projects, topics, and findings
- Answer questions using the accumulated knowledge base from all projects
- Suggest connections, gaps, and next steps across the whole account

CAPABILITIES:
1. Answer questions about any project or research topic
2. Compare and contrast findings between projects and sessions
3. Identify patterns, themes, and repeated insights across projects
4. Suggest next steps and priorities at the account level
5. Help with cross-project task planning and note-taking
6. View and discuss scheduled posts across all projects
7. Generate images, videos, and podcasts using context from any project

BROWSER AUTOMATION (Pro Feature):
CRITICAL CONTEXT AWARENESS - READ THIS FIRST:
Before invoking ANY tool (especially browser automation), ALWAYS consider the conversation history:
- If YOUR previous message ASKED the user for input (e.g., "What caption would you like?", "What subject line?", "Describe the product"), then the user's reply is CONTENT/DATA, NOT a new instruction.
- NEVER trigger browser automation just because the user's reply contains keywords like "automation", "browse", "scrape", "browser", etc., when they are clearly providing a caption, description, title, or other requested content.
- Only trigger browser automation when the user is INITIATING A NEW REQUEST that explicitly requires live web interaction, NOT when they are responding to your question.

You have the ability to control a web browser for tasks that require real-time interaction with websites. When the user asks you to:
- Search for products, prices, or compare items on shopping sites
- Check current/live data (stock prices, weather, news, availability)
- Fill out forms or submit applications
- Navigate websites and extract real-time information
- Any task that explicitly mentions "use the browser", "automate", or requires live web interaction

You should acknowledge that you CAN do this and explain that you will start the browser automation. Example responses:
- "I can help with that! Let me open the browser and search for iPhones on BestBuy..."
- "I'll automate that for you. Starting browser automation to check pricing..."

The browser automation will appear inline in the chat with a live view of the browser session.

ACCOUNT CONTEXT:
${context.fullContext}
${scheduledPostsContext}
${allActivityContext}

Remember: you can reference and combine information from all projects at once. When helpful, name which project(s) or topics you are drawing from so the user can trace the reasoning.`;
};

export const buildConversationHistory = (messages: ChatMessage[]): { role: string; parts: { text: string }[] }[] => {
    return messages.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
    }));
};

export const contextService = {
    buildProjectContext,
    buildAccountContext,
    buildResearchSessionContext,
    getProjectSystemInstruction,
    getAccountSystemInstruction,
    buildConversationHistory,
    getKnowledgeBaseForResearch
};

export default contextService;
