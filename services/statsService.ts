import { ResearchProject } from '../types.js';

/**
 * Computes the total number of sources for a project.
 * Sources include: research citations, uploaded files, knowledge base, 
 * YouTube videos, news articles, synced Google Docs/Sheets, and Drive imports.
 */
export const computeSourceCount = (project: ResearchProject): number => {
    let count = 0;
    const sessions = project.researchSessions || [];

    // Session-level sources
    sessions.forEach(session => {
        // Research report citation sources
        count += session.researchReport?.sources?.length || 0;
        // Session uploaded files (knowledge base items attached to session)
        count += (session.uploadedFiles || []).length;
        // YouTube videos in research reports
        count += session.researchReport?.youtubeVideos?.length || 0;
    });

    // Project-level knowledge base files
    count += (project.knowledgeBase || []).length;

    // Project-level uploaded files (Gemini Files API)
    count += (project.uploadedFiles || []).length;

    // YouTube videos at project level
    count += (project.youtubeVideos || []).length;

    // News articles
    count += (project.newsArticles || []).length;

    // Google integrations
    if (project.googleIntegrations) {
        // Synced Google Docs
        count += (project.googleIntegrations.syncedDocs || []).length;
        // Synced Google Sheets
        count += (project.googleIntegrations.syncedSheets || []).length;
        // Imported Drive files
        count += (project.googleIntegrations.driveFiles || []).length;
    }

    return count;
};

/**
 * Computes the total number of high-fidelity assets for a project.
 * Consolidation of logic from ProjectDashboard.tsx and ProjectAssets.tsx
 */
export const computeAssetCount = (project: ResearchProject): number => {
    const sessions = project.researchSessions || [];
    let total = 0;

    sessions.forEach(session => {
        const report = session.researchReport;
        if (!report) return;

        // Header images
        if (report.headerImageUrl && !report.headerImageUrl.includes('placehold.co')) {
            total += 1;
        }

        // Slide images
        if (report.slides) {
            report.slides.forEach(slide => {
                if (slide.imageUrl && !slide.imageUrl.includes('placehold.co')) {
                    total += 1;
                }
                if (slide.imageUrls) {
                    slide.imageUrls.forEach(url => {
                        if (url && !url.includes('placehold.co')) {
                            total += 1;
                        }
                    });
                }
            });
        }

        // Note map images (Session level)
        if (session.noteMapState) {
            session.noteMapState.forEach(node => {
                if (node.imageUrl && !node.imageUrl.includes('placehold.co')) {
                    total += 1;
                }
            });
        }

        // Blog posts
        if (report.blogPost && report.blogPost.content) {
            total += 1;
        }

        // Social campaign posts
        if (report.socialCampaign?.posts) {
            report.socialCampaign.posts.forEach(post => {
                if (post.imageUrl && !post.imageUrl.includes('placehold.co')) {
                    total += 1;
                }
            });
        }

        // Videos (Session-level video post)
        if (report.videoPost && report.videoPost.videoUrl) {
            total += 1;
        }

        // Websites
        const websites = session.websiteVersions || [];
        total += websites.length;

        // Books and Book Pages
        if (report.books) {
            report.books.forEach(book => {
                total += 1; // The book itself
                if (book.pages) {
                    book.pages.forEach(page => {
                        if (page.imageUrl) {
                            total += 1; // The page image
                        }
                    });
                }
            });
        }

        // Tables
        if (report.tables && report.tables.length > 0) {
            total += report.tables.length;
        }

        // Session-level uploads that are considered assets (videos, books, etc.)
        if (session.uploadedFiles) {
            session.uploadedFiles.forEach(file => {
                if (file.type.startsWith('video/') || file.type.startsWith('audio/') || (file.type.startsWith('text/') && file.name.endsWith('.md'))) {
                    total += 1;
                }
            });
        }
    });

    // Project Level Assets

    // Knowledge base files (videos, audio, documents)
    const knowledgeBase = project.knowledgeBase || [];
    knowledgeBase.forEach(file => {
        if (file.type.startsWith('video/')) {
            total += 1;
        } else if (file.type.startsWith('audio/')) {
            total += 1;
        } else if (file.type.startsWith('text/') && file.name.endsWith('.md')) {
            total += 1;
        }
    });

    // Uploaded Files (Images)
    const uploadedFiles = project.uploadedFiles || [];
    uploadedFiles.forEach(file => {
        if (file.mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(file.name)) {
            total += 1;
        }
    });

    // Project Level Note Map Images
    if (project.projectNoteMapState) {
        project.projectNoteMapState.forEach(node => {
            if (node.imageUrl && !node.imageUrl.includes('placehold.co')) {
                total += 1;
            }
        });
    }

    // Lead Forms
    if (project.leadForms) {
        total += project.leadForms.length;
    }

    // Stripe Products
    if (project.stripeProducts) {
        project.stripeProducts.forEach(product => {
            if (product.active) {
                total += 1;
            }
        });
    }

    // Chat Images
    if (project.projectConversations) {
        project.projectConversations.forEach(conv => {
            if (conv.messages) {
                conv.messages.forEach(msg => {
                    if (msg.imageUrl && !msg.imageUrl.includes('placehold.co')) {
                        total += 1;
                    }
                });
            }
        });
    }

    return total;
};
