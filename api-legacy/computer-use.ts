/**
 * Computer Use API Handler
 * Enables Gemini Computer Use for Pro users via Browserbase integration.
 * 
 * Improvements based on documentation review:
 * - Proper conversation history management between turns
 * - Thinking config for better reasoning
 * - Safety system instructions
 * - Proper function response format with screenshots
 * - Full screenshot storage for frontend display
 * - Session replay URL from Browserbase
 * 
 * Operations:
 * - POST /api/computer-use?op=start - Start a Computer Use session
 * - GET /api/computer-use?op=status - Poll session status
 * - POST /api/computer-use?op=confirm - Confirm a safety action
 * - POST /api/computer-use?op=cancel - Cancel session
 */

import { requireAuth } from './_auth.js';
import type { AuthContext } from './_auth.js';
import { Client as QStashClient } from '@upstash/qstash';

// Environment variables
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
const browserbaseProjectId = process.env.BROWSERBASE_PROJECT_ID;
const qstashToken = process.env.QSTASH_TOKEN;
const vercelBypassToken = process.env.VERCEL_PROTECTION_BYPASS || '';
const appUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.APP_URL || 'http://localhost:3000';

// Build QStash callback URL with optional Vercel protection bypass
const buildQStashUrl = (action: string) => {
    const baseUrl = `${appUrl}/api/computer-use?action=${action}`;
    return vercelBypassToken ? `${baseUrl}&x-vercel-protection-bypass=${vercelBypassToken}` : baseUrl;
};

// Initialize QStash client
const qstash = qstashToken ? new QStashClient({ token: qstashToken }) : null;

// Constants
const COMPUTER_USE_MODEL = 'gemini-3-flash-preview';
// Use Google-recommended viewport size for optimal Computer Use performance
const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 900;
const MAX_TURNS = 15;
const GENERATE_CONTENT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Safety system instructions (per Google's documentation)
const SAFETY_SYSTEM_INSTRUCTION = `You are a browser automation assistant that completes tasks by interacting with web pages. Today's date is ${new Date().toLocaleDateString()}.

## YOUR PRIMARY GOAL
Use browser actions (clicking, typing, navigating, scrolling) to complete the user's task. Take action immediately - do not just describe what you would do.

## HOW TO WORK
1. Look at the screenshot to understand the current page state
2. Determine the next action needed to progress toward the goal
3. Execute that action using the appropriate function call (click_at, type_text_at, navigate, etc.)
4. After each action, analyze the new screenshot and continue until the task is complete

## RULE 1: Seek User Confirmation (USER_CONFIRMATION)
If the next action falls into these categories, STOP and request user confirmation:
- **Financial Transactions:** Completing purchases, payments, money transfers
- **Sending Communications:** Sending emails, messages, social media posts
- **Account Actions:** Logging in, signing up, changing passwords
- **Legal Agreements:** Accepting Terms of Service, Privacy Policies
- **Robot Detection:** CAPTCHAs or anti-bot challenges

For these actions, prepare everything (fill forms, navigate to the page) then STOP before the final submit/send action.

## RULE 2: Default Behavior (ACTUATE)
For all other actions, proceed immediately without asking permission. Take action now!

## WHEN TO FINISH
Only provide a text response (without function calls) when:
- The task is fully completed and you can report the results
- You need user confirmation for a sensitive action
- An insurmountable error occurred

Remember: Your job is to TAKE ACTIONS, not describe actions. Use function calls to interact with the browser.`;



// Types
interface ConversationPart {
    text?: string;
    inline_data?: { mime_type: string; data: string };
    function_call?: { name: string; args: Record<string, any> };
    function_response?: { name: string; response: Record<string, any> };
}

interface ConversationTurn {
    role: 'user' | 'model';
    parts: ConversationPart[];
}

interface ComputerUseSession {
    id: string;
    browserbaseSessionId?: string;
    browserbaseConnectUrl?: string;
    status: 'starting' | 'in_progress' | 'awaiting_confirmation' | 'completed' | 'failed' | 'cancelled';
    goal: string;
    screenshotBase64?: string;
    currentUrl?: string;
    pendingAction?: {
        name: string;
        args: Record<string, any>;
        safetyDecision?: { decision: string; explanation: string };
    };
    actions: Array<{ name: string; timestamp: number; result?: any }>;
    conversationHistory: ConversationTurn[];
    turns: number;
    finalResult?: string;
    modelThoughts?: string;
    error?: string;
    replayUrl?: string;
    liveViewUrl?: string; // Live View URL for real-time iframe embedding
    createdAt: number;
    updatedAt: number;
}

/**
 * Use Gemini to analyze the user's goal and determine the best starting URL.
 * This is smarter than regex - it can understand intent like:
 * - "find cheap phones" → https://www.amazon.com or shopping site
 * - "research AI tools" → https://www.google.com
 * - "check weather in NYC" → https://weather.com
 */
const analyzeGoalForUrl = async (goal: string): Promise<string> => {
    if (!apiKey) {
        console.log('[ComputerUse] No API key for URL analysis, using Google');
        return 'https://www.google.com';
    }

    try {
        const response = await fetch(`${GENERATE_CONTENT_ENDPOINT}/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{
                        text: `Analyze this user goal and determine the best starting URL for a browser automation task.

User Goal: "${goal}"

Instructions:
1. If the goal mentions a specific website (like "on amazon.com", "at bestbuy", "on youtube"), return that site's URL.
2. If the goal implies a type of task, suggest the most relevant site:
   - Shopping/buying/price comparison → https://www.google.com/shopping or a major retailer
   - Weather → https://weather.com
   - News → https://news.google.com  
   - Maps/directions → https://maps.google.com
   - Videos → https://www.youtube.com
   - Jobs → https://www.linkedin.com/jobs
   - Reviews/restaurants → https://www.yelp.com
   - Travel/flights → https://www.google.com/flights
   - Hotels → https://www.booking.com
   - Real estate → https://www.zillow.com
3. For general research or unclear goals, use https://www.google.com

Return ONLY the URL, nothing else. No explanation, no markdown, just the URL starting with https://`
                    }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 100,
                }
            })
        });

        if (!response.ok) {
            console.error('[ComputerUse] URL analysis API error:', response.status);
            return 'https://www.google.com';
        }

        const data = await response.json();
        const urlText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

        // Validate it looks like a URL
        if (urlText.startsWith('https://') || urlText.startsWith('http://')) {
            console.log(`[ComputerUse] AI suggested URL: ${urlText}`);
            return urlText;
        }

        // If not a valid URL, try to extract one
        const urlMatch = urlText.match(/https?:\/\/[^\s,)]+/);
        if (urlMatch) {
            console.log(`[ComputerUse] Extracted URL from AI response: ${urlMatch[0]}`);
            return urlMatch[0];
        }

        console.log('[ComputerUse] AI response was not a valid URL, using Google');
        return 'https://www.google.com';
    } catch (e: any) {
        console.error('[ComputerUse] URL analysis failed:', e.message);
        return 'https://www.google.com';
    }
};

/**
 * Quick regex-based fallback to extract URLs from the user's goal.
 * Used as a fast check before AI analysis.
 */
const extractUrlFromGoal = (goal: string): string | null => {
    const lowerGoal = goal.toLowerCase();

    // Try to find a full URL first (https:// or http://)
    const fullUrlMatch = goal.match(/https?:\/\/[^\s,)]+/i);
    if (fullUrlMatch) {
        return fullUrlMatch[0];
    }

    // Try to find domain patterns like "on bestbuy.com", "at amazon.com", "to google.com"
    const domainPatterns = [
        /(?:on|at|to|from|visit|go\s+to|navigate\s+to|open)\s+(?:the\s+)?(?:www\.)?([a-z0-9][-a-z0-9]*\.(?:com|org|net|io|co|dev|ai|app|edu|gov|shop|store))/i,
        /([a-z0-9][-a-z0-9]*\.(?:com|org|net|io|co))(?:\s+(?:website|site|page))?/i,
    ];

    for (const pattern of domainPatterns) {
        const match = goal.match(pattern);
        if (match && match[1]) {
            const domain = match[1].toLowerCase();
            // Skip common words that look like domains
            if (['high.com', 'low.com', 'new.com', 'old.com'].includes(domain)) continue;
            return `https://www.${domain}`;
        }
    }

    // Check for common site keywords
    const siteKeywords: Record<string, string> = {
        // Shopping
        'bestbuy': 'https://www.bestbuy.com',
        'best buy': 'https://www.bestbuy.com',
        'amazon': 'https://www.amazon.com',
        'walmart': 'https://www.walmart.com',
        'target': 'https://www.target.com',
        'ebay': 'https://www.ebay.com',
        'newegg': 'https://www.newegg.com',
        'etsy': 'https://www.etsy.com',
        'aliexpress': 'https://www.aliexpress.com',
        'costco': 'https://www.costco.com',
        'ikea': 'https://www.ikea.com',
        'wayfair': 'https://www.wayfair.com',
        'home depot': 'https://www.homedepot.com',
        'lowes': 'https://www.lowes.com',
        // Social
        'pinterest': 'https://www.pinterest.com',
        'facebook': 'https://www.facebook.com',
        'twitter': 'https://www.twitter.com',
        'instagram': 'https://www.instagram.com',
        'linkedin': 'https://www.linkedin.com',
        'tiktok': 'https://www.tiktok.com',
        'reddit': 'https://www.reddit.com',
        // Media
        'youtube': 'https://www.youtube.com',
        'netflix': 'https://www.netflix.com',
        'spotify': 'https://www.spotify.com',
        // Travel
        'airbnb': 'https://www.airbnb.com',
        'booking': 'https://www.booking.com',
        'expedia': 'https://www.expedia.com',
        // Real estate
        'zillow': 'https://www.zillow.com',
        'redfin': 'https://www.redfin.com',
        // News
        'cnn': 'https://www.cnn.com',
        'bbc': 'https://www.bbc.com',
        // Tech
        'github': 'https://www.github.com',
        'stackoverflow': 'https://stackoverflow.com',
        'stack overflow': 'https://stackoverflow.com',
        // Reference
        'wikipedia': 'https://www.wikipedia.org',
        'yelp': 'https://www.yelp.com',
        'craigslist': 'https://www.craigslist.org',
        // Google
        'google shopping': 'https://shopping.google.com',
        'google maps': 'https://maps.google.com',
        'google': 'https://www.google.com',
    };

    // Check for site keywords (longer phrases first)
    const sortedKeywords = Object.keys(siteKeywords).sort((a, b) => b.length - a.length);
    for (const keyword of sortedKeywords) {
        if (lowerGoal.includes(keyword)) {
            return siteKeywords[keyword];
        }
    }

    return null;
};


// Firestore session storage (persists across serverless invocations)
// This replaces the in-memory Map which gets reset on each function invocation

let firestoreInitialized = false;
const ensureFirestoreForSessions = async () => {
    if (firestoreInitialized) return;
    firestoreInitialized = true;

    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    if (getApps().length) return;

    const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        process.env.FIREBASE_SERVICE_ACCOUNT ||
        process.env.FIREBASE_ADMIN_CREDENTIALS || '{}'
    );
    if (serviceAccount.client_email && serviceAccount.private_key) {
        initializeApp({
            credential: cert({
                projectId: serviceAccount.project_id || 'ffresearchr',
                clientEmail: serviceAccount.client_email,
                privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
            }),
        });
    }
};

const getSession = async (sessionId: string): Promise<ComputerUseSession | null> => {
    await ensureFirestoreForSessions();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const doc = await db.collection('computerUseSessions').doc(sessionId).get();
    if (!doc.exists) return null;

    const data = doc.data() as any;

    // Deserialize conversation history from JSON string
    let conversationHistory: ConversationTurn[] = [];
    if (typeof data.conversationHistory === 'string') {
        try {
            conversationHistory = JSON.parse(data.conversationHistory);
        } catch {
            conversationHistory = [];
        }
    } else if (Array.isArray(data.conversationHistory)) {
        conversationHistory = data.conversationHistory;
    }

    return {
        ...data,
        conversationHistory,
    } as ComputerUseSession;
};

const saveSession = async (session: ComputerUseSession): Promise<void> => {
    await ensureFirestoreForSessions();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    // Remove screenshotBase64 from Firestore (too large) - store only metadata
    // Conversation history IS stored (as JSON) because we need it across QStash invocations
    const { screenshotBase64, ...sessionData } = session;

    // Serialize conversation history as JSON string (Firestore has 1MB limit per doc)
    const serializedSession = {
        ...sessionData,
        conversationHistory: JSON.stringify(sessionData.conversationHistory || []),
        updatedAt: Date.now(),
    };

    await db.collection('computerUseSessions').doc(session.id).set(serializedSession);
};

const deleteSession = async (sessionId: string): Promise<void> => {
    await ensureFirestoreForSessions();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.collection('computerUseSessions').doc(sessionId).delete();
};

// Runtime session cache for current request (for conversation history which is too large for Firestore)
const sessionCache = new Map<string, ComputerUseSession>();


// Helper functions
const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (message: string, status = 400, details?: any) =>
    json({ error: message, details }, status);

const generateSessionId = () =>
    `cu_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

// Coordinate denormalization (0-999 -> actual pixels)
const denormX = (x: number) => Math.round((x / 1000) * SCREEN_WIDTH);
const denormY = (y: number) => Math.round((y / 1000) * SCREEN_HEIGHT);

// Browserbase API helpers
const createBrowserbaseSession = async (): Promise<{ sessionId: string; connectUrl: string }> => {
    if (!browserbaseApiKey || !browserbaseProjectId) {
        throw new Error('Browserbase credentials not configured. Add BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to environment.');
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const res = await fetch('https://api.browserbase.com/v1/sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-bb-api-key': browserbaseApiKey,
            },
            body: JSON.stringify({
                projectId: browserbaseProjectId,
                // Keep session alive between Playwright connections (prevents 410 Gone)
                keepAlive: true,
                // 5 minute timeout for the session
                timeout: 300,
                browserSettings: {
                    viewport: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
                },
            }),
        });

        if (res.ok) {
            const data = await res.json();
            return {
                sessionId: data.id,
                connectUrl: data.connectUrl,
            };
        }

        const text = await res.text().catch(() => res.statusText);

        // Handle rate limiting with retry
        if (res.status === 429) {
            // Parse retry-after from response if available
            const retryMatch = text.match(/(\d+)\s*seconds/i);
            const waitSeconds = retryMatch ? parseInt(retryMatch[1]) + 2 : (attempt + 1) * 15;
            console.log(`[ComputerUse] Rate limited, waiting ${waitSeconds}s before retry ${attempt + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
            lastError = new Error(`Browserbase rate limit (429): ${text}`);
            continue;
        }

        // Non-retryable error
        throw new Error(`Browserbase session creation failed: ${res.status} ${text}`);
    }

    throw lastError || new Error('Browserbase session creation failed after retries');
};

// Close Browserbase session to free up concurrent session slot
const closeBrowserbaseSession = async (sessionId: string): Promise<void> => {
    if (!browserbaseApiKey || !browserbaseProjectId || !sessionId) return;

    try {
        console.log(`[ComputerUse] Closing Browserbase session ${sessionId}`);
        const res = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-bb-api-key': browserbaseApiKey,
            },
            body: JSON.stringify({
                projectId: browserbaseProjectId,
                status: 'REQUEST_RELEASE'
            }),
        });

        if (!res.ok) {
            console.error(`[ComputerUse] Failed to close session ${sessionId}: ${res.status}`);
        } else {
            console.log(`[ComputerUse] Successfully closed Browserbase session ${sessionId}`);
        }
    } catch (e) {
        console.error(`[ComputerUse] Error closing Browserbase session:`, e);
    }
};

// Get Live View URL for real-time browser viewing
const getLiveViewUrl = async (sessionId: string): Promise<string | null> => {
    if (!browserbaseApiKey) return null;

    try {
        const res = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/debug`, {
            headers: { 'x-bb-api-key': browserbaseApiKey },
        });

        if (!res.ok) {
            console.error(`Failed to get Live View URL: ${res.status}`);
            return null;
        }

        const data = await res.json();
        // Return fullscreen debugger URL with hidden navbar for clean embedding
        const liveViewUrl = data.debuggerFullscreenUrl || data.debuggerUrl;
        return liveViewUrl ? `${liveViewUrl}&navbar=false` : null;
    } catch (e) {
        console.error('Error fetching Live View URL:', e);
        return null;
    }
};

const getBrowserbaseScreenshot = async (connectUrl: string): Promise<string> => {
    // Use Playwright CDP to capture screenshot - per Browserbase documentation
    const { chromium } = await import('playwright-core');
    let browser;
    try {
        browser = await chromium.connectOverCDP(connectUrl);
        const context = browser.contexts()[0];
        const page = context?.pages()[0];

        if (!page) {
            throw new Error('No page found in browser session');
        }

        // Wait for page to be ready
        await page.waitForLoadState('domcontentloaded').catch(() => { });

        // Capture screenshot using Playwright (internally uses CDP)
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        return screenshotBuffer.toString('base64');
    } finally {
        // Don't close the browser - just disconnect from CDP
        // browser.close() would terminate the Browserbase session
        // The CDP connection will be released when the object is garbage collected
    }
};

const getBrowserbaseCurrentUrl = async (connectUrl: string): Promise<string> => {
    const { chromium } = await import('playwright-core');
    let browser;
    try {
        browser = await chromium.connectOverCDP(connectUrl);
        const context = browser.contexts()[0];
        const page = context?.pages()[0];
        return page?.url() || '';
    } catch {
        return '';
    } finally {
        // Don't close the browser - just disconnect from CDP
    }
};

const executeBrowserbaseAction = async (
    connectUrl: string,
    action: { name: string; args: Record<string, any> }
): Promise<{ url: string; success: boolean; error?: string; screenshot?: string }> => {
    const { chromium } = await import('playwright-core');
    let browser;

    try {
        browser = await chromium.connectOverCDP(connectUrl);
        const context = browser.contexts()[0];
        const page = context?.pages()[0];

        if (!page) {
            throw new Error('No page found in browser session');
        }

        const { name, args } = action;

        switch (name) {
            case 'navigate':
                // Use networkidle for full page load, with fallback to domcontentloaded
                await page.goto(args.url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => {
                    // Fallback to domcontentloaded if networkidle times out (common on heavy sites)
                    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                });
                break;
            case 'click_at': {
                const x = denormX(args.x);
                const y = denormY(args.y);
                await page.mouse.click(x, y);
                break;
            }
            case 'type_text_at': {
                const x = denormX(args.x);
                const y = denormY(args.y);
                await page.mouse.click(x, y);
                if (args.clear_before_typing !== false) {
                    await page.keyboard.press('Meta+A');
                    await page.keyboard.press('Backspace');
                }
                await page.keyboard.type(args.text);
                if (args.press_enter !== false) {
                    await page.keyboard.press('Enter');
                }
                break;
            }
            case 'scroll_document':
                if (args.direction === 'down') {
                    await page.keyboard.press('PageDown');
                } else if (args.direction === 'up') {
                    await page.keyboard.press('PageUp');
                } else if (args.direction === 'left') {
                    await page.keyboard.press('Home');
                } else if (args.direction === 'right') {
                    await page.keyboard.press('End');
                }
                break;
            case 'scroll_at': {
                const x = denormX(args.x);
                const y = denormY(args.y);
                const delta = args.magnitude ?? 800;
                await page.mouse.move(x, y);
                if (args.direction === 'down') {
                    await page.mouse.wheel(0, delta);
                } else if (args.direction === 'up') {
                    await page.mouse.wheel(0, -delta);
                } else if (args.direction === 'right') {
                    await page.mouse.wheel(delta, 0);
                } else if (args.direction === 'left') {
                    await page.mouse.wheel(-delta, 0);
                }
                break;
            }
            case 'go_back':
                await page.goBack({ timeout: 10000 }).catch(() => { });
                break;
            case 'go_forward':
                await page.goForward({ timeout: 10000 }).catch(() => { });
                break;
            case 'wait_5_seconds':
                await new Promise(resolve => setTimeout(resolve, 5000));
                break;
            case 'key_combination':
                await page.keyboard.press(args.keys);
                break;
            case 'hover_at': {
                const x = denormX(args.x);
                const y = denormY(args.y);
                await page.mouse.move(x, y);
                break;
            }
            case 'search':
            case 'open_web_browser':
                await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
                break;
            case 'drag_and_drop': {
                const startX = denormX(args.x);
                const startY = denormY(args.y);
                const endX = denormX(args.destination_x);
                const endY = denormY(args.destination_y);
                await page.mouse.move(startX, startY);
                await page.mouse.down();
                await page.mouse.move(endX, endY);
                await page.mouse.up();
                break;
            }
            default:
                return { url: '', success: false, error: `Unknown action: ${name}` };
        }

        // Wait for page to settle with smart waiting
        // Try networkidle first (waits for all network activity to stop)
        // Fall back to domcontentloaded if it takes too long
        await Promise.race([
            page.waitForLoadState('networkidle').catch(() => { }),
            new Promise(resolve => setTimeout(resolve, 5000)) // Max 5s for networkidle
        ]);
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        // Extra settling time for JavaScript renders
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Capture screenshot after action
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        const screenshot = screenshotBuffer.toString('base64');

        return { url: page.url(), success: true, screenshot };
    } catch (e: any) {
        return { url: '', success: false, error: e.message || String(e) };
    } finally {
        // Don't close the browser - just disconnect from CDP
        // browser.close() would terminate the Browserbase session
    }
};

// Gemini Computer Use API call with proper conversation history
const callComputerUseModel = async (
    session: ComputerUseSession,
    screenshotBase64: string
): Promise<{
    text?: string;
    thoughts?: string;
    functionCalls?: Array<{ name: string; args: Record<string, any> }>;
    modelContent?: ConversationTurn;
    done: boolean;
}> => {
    if (!apiKey) throw new Error('Gemini API key not configured');

    // Build contents array from conversation history
    // The conversation history contains:
    // - Initial user turn (goal + screenshot)
    // - Model responses (function calls)  
    // - User turns with function responses + screenshots
    const contents: any[] = [...session.conversationHistory];

    // If this is the first turn, add the initial user message with goal + screenshot
    if (contents.length === 0) {
        const initialUserTurn = {
            role: 'user',
            parts: [
                { text: session.goal },
                {
                    inline_data: {
                        mime_type: 'image/png',
                        data: screenshotBase64,
                    },
                },
            ],
        };
        contents.push(initialUserTurn);
        // Save initial user turn to conversation history so it persists across serverless invocations
        session.conversationHistory.push(initialUserTurn as ConversationTurn);
    }
    // For subsequent turns, the conversation history already has everything we need:
    // - The model's last response (with function_calls) was added at processNextTurn line 1070
    // - Our function responses (with screenshots) were added at processNextTurn lines 1157-1160
    // So we just use contents as-is from conversationHistory

    const requestBody = {
        contents,
        systemInstruction: { parts: [{ text: SAFETY_SYSTEM_INSTRUCTION }] },
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
        },
        tools: [
            {
                computer_use: {
                    environment: 'ENVIRONMENT_BROWSER',
                },
            },
        ],
        // Note: thinkingConfig is NOT supported by the Computer Use model
    };

    console.log(`[ComputerUse] Calling Gemini API: model=${COMPUTER_USE_MODEL}, contents=${contents.length} turns, hasScreenshot=true`);

    const res = await fetch(
        `${GENERATE_CONTENT_ENDPOINT}/${COMPUTER_USE_MODEL}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        }
    );

    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        console.error(`[ComputerUse] Gemini API error: ${res.status} ${text.substring(0, 500)}`);
        throw new Error(`Computer Use API failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    console.log(`[ComputerUse] Gemini API response received, parts count: ${data.candidates?.[0]?.content?.parts?.length || 0}`);
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('No response from Computer Use model');

    const parts = candidate.content?.parts || [];

    // Extract different part types
    const textParts = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text);
    const thoughtParts = parts.filter((p: any) => p.thought).map((p: any) => p.thought);
    const functionCalls = parts
        .filter((p: any) => p.functionCall || p.function_call)
        .map((p: any) => {
            const fc = p.functionCall || p.function_call;
            return {
                name: fc.name,
                args: fc.args || {},
            };
        });

    const done = functionCalls.length === 0;

    // Save model's response for conversation history
    const modelContent: ConversationTurn = {
        role: 'model',
        parts: candidate.content.parts,
    };

    return {
        text: textParts.join('\n'),
        thoughts: thoughtParts.join('\n'),
        functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
        modelContent,
        done,
    };
};

// Main handler
export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        // Use 'action' param since 'op' is used by the parent router (api/research.ts)
        const action = url.searchParams.get('action') || url.searchParams.get('op') || '';

        // Skip auth for process-turn (QStash callback) - it uses internal validation
        const isQStashCallback = action === 'process-turn';

        let authResult: AuthContext | Response | null = null;
        if (!isQStashCallback) {
            // Auth check for user-facing endpoints
            authResult = await requireAuth(request);
            if (authResult instanceof Response) return authResult;

            // Subscription check (Pro users only) - inline to avoid import issues
            try {
                const { initializeApp, getApps, cert } = await import('firebase-admin/app');
                const { getFirestore } = await import('firebase-admin/firestore');

                if (!getApps().length) {
                    const serviceAccount = JSON.parse(
                        process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
                        process.env.FIREBASE_SERVICE_ACCOUNT ||
                        process.env.FIREBASE_ADMIN_CREDENTIALS || '{}'
                    );
                    if (serviceAccount.client_email && serviceAccount.private_key) {
                        initializeApp({
                            credential: cert({
                                projectId: serviceAccount.project_id || 'ffresearchr',
                                clientEmail: serviceAccount.client_email,
                                privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
                            }),
                        });
                    }
                }

                const db = getFirestore();
                const userDoc = await db.collection('users').doc(authResult.uid).get();
                const userData = userDoc.data();

                if (!userData?.subscribed) {
                    return error('Pro subscription required for Computer Use', 403);
                }
            } catch (subError: any) {
                console.error('[computer-use] Subscription check failed:', subError);
                return error('Failed to verify subscription', 500);
            }
        }

        if (!apiKey) {
            return error('Missing Gemini API key', 500);
        }

        switch (action) {
            case 'start': {
                if (request.method !== 'POST') return error('Method not allowed', 405);

                try {
                    const body = await request.json();
                    const goal = (body.goal || '').toString().trim();

                    if (!goal) return error('Missing goal', 400);

                    // Prioritize: 1) explicit URL, 2) fast regex extraction, 3) AI analysis, 4) fallback to Google
                    const explicitUrl = body.initialUrl ? body.initialUrl.toString().trim() : null;
                    // Try fast regex first to save latency
                    const regexExtractedUrl = explicitUrl ? null : extractUrlFromGoal(goal);
                    // Only call AI if regex didn't find anything
                    const aiSuggestedUrl = (explicitUrl || regexExtractedUrl) ? null : await analyzeGoalForUrl(goal);
                    const initialUrl = explicitUrl || regexExtractedUrl || aiSuggestedUrl || 'https://www.google.com';

                    console.log(`[ComputerUse] Goal: "${goal.substring(0, 100)}..."`);
                    console.log(`[ComputerUse] Regex extracted URL: ${regexExtractedUrl || 'none'}`);
                    console.log(`[ComputerUse] AI suggested URL: ${aiSuggestedUrl || 'none (skipped or fallback)'}`);
                    console.log(`[ComputerUse] Using initialUrl: ${initialUrl}`);

                    // Create Browserbase session
                    let browserbaseSession;
                    try {
                        browserbaseSession = await createBrowserbaseSession();
                    } catch (e: any) {
                        return error(`Browser session failed: ${e.message}`, 500);
                    }

                    // Navigate to initial URL
                    await executeBrowserbaseAction(browserbaseSession.connectUrl, {
                        name: 'navigate',
                        args: { url: initialUrl },
                    });

                    // Wait for page load
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Get Live View URL for real-time viewing
                    const liveViewUrl = await getLiveViewUrl(browserbaseSession.sessionId);

                    // Create session
                    const sessionId = generateSessionId();
                    const session: ComputerUseSession = {
                        id: sessionId,
                        browserbaseSessionId: browserbaseSession.sessionId,
                        browserbaseConnectUrl: browserbaseSession.connectUrl,
                        status: 'in_progress',
                        goal,
                        currentUrl: initialUrl,
                        actions: [],
                        conversationHistory: [],
                        turns: 0,
                        replayUrl: `https://browserbase.com/sessions/${browserbaseSession.sessionId}`,
                        liveViewUrl: liveViewUrl || undefined,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    };

                    // Save session to both Firestore and cache
                    await saveSession(session);
                    sessionCache.set(sessionId, session);

                    // Log QStash status for debugging
                    console.log(`[ComputerUse] QStash configured: ${!!qstash}, token present: ${!!qstashToken}`);

                    // Run first turn - either via QStash or synchronously
                    if (qstash) {
                        // Queue first turn via QStash for background processing
                        try {
                            await qstash.publishJSON({
                                url: buildQStashUrl('process-turn'),
                                body: { sessionId },
                                retries: 3,
                            });
                            console.log(`[ComputerUse] Queued first turn via QStash for session ${sessionId}`);
                        } catch (qstashError: any) {
                            console.error(`[ComputerUse] QStash publish failed, running synchronously:`, qstashError);
                            // Fallback to sync if QStash fails
                            await processNextTurn(sessionId);
                        }
                    } else {
                        // No QStash - run first turn synchronously (required for serverless)
                        console.log(`[ComputerUse] Running first turn synchronously for session ${sessionId}`);
                        await processNextTurn(sessionId);
                    }

                    // Get updated session state after first turn
                    const updatedSession = sessionCache.get(sessionId) || await getSession(sessionId) || session;

                    // Return session info with current state
                    return json({
                        sessionId,
                        status: updatedSession.status,
                        currentUrl: updatedSession.currentUrl,
                        screenshotBase64: updatedSession.screenshotBase64,
                        replayUrl: updatedSession.replayUrl,
                        liveViewUrl: updatedSession.liveViewUrl,
                        turns: updatedSession.turns,
                        actions: updatedSession.actions?.map(a => ({ name: a.name, timestamp: a.timestamp })) || [],
                        finalResult: updatedSession.finalResult,
                        modelThoughts: updatedSession.modelThoughts,
                        error: updatedSession.error,
                    });
                } catch (e: any) {
                    return error(e.message || 'Failed to start session', 500);
                }
            }

            case 'status': {
                const sessionId = url.searchParams.get('sessionId') || '';
                if (!sessionId) return error('Missing sessionId', 400);

                const session = sessionCache.get(sessionId) || await getSession(sessionId);
                if (!session) return error('Session not found', 404);

                return json({
                    sessionId: session.id,
                    status: session.status,
                    screenshotBase64: session.screenshotBase64,
                    currentUrl: session.currentUrl,
                    pendingAction: session.pendingAction,
                    actions: session.actions,
                    turns: session.turns,
                    finalResult: session.finalResult,
                    modelThoughts: session.modelThoughts,
                    error: session.error,
                    replayUrl: session.replayUrl,
                    liveViewUrl: session.liveViewUrl,
                });
            }

            case 'confirm': {
                if (request.method !== 'POST') return error('Method not allowed', 405);

                const body = await request.json();
                const sessionId = (body.sessionId || '').toString().trim();
                const confirmed = body.confirmed === true;

                if (!sessionId) return error('Missing sessionId', 400);

                const session = sessionCache.get(sessionId) || await getSession(sessionId);
                if (!session) return error('Session not found', 404);
                if (session.status !== 'awaiting_confirmation') {
                    return error('Session not awaiting confirmation', 400);
                }

                if (!confirmed) {
                    session.status = 'cancelled';
                    session.updatedAt = Date.now();
                    return json({ sessionId, status: 'cancelled' });
                }


                // User confirmed, execute the pending action with safety acknowledgement
                if (session.pendingAction && session.browserbaseConnectUrl) {
                    const result = await executeBrowserbaseAction(
                        session.browserbaseConnectUrl,
                        session.pendingAction
                    );
                    session.actions.push({
                        name: session.pendingAction.name,
                        timestamp: Date.now(),
                        result: { ...result, safetyAcknowledged: true },
                    });
                    session.currentUrl = result.url || session.currentUrl;

                    // Add function response with safety acknowledgement to conversation history
                    // This ensures the model sees that the user confirmed the action
                    const newScreenshot = await getBrowserbaseScreenshot(session.browserbaseConnectUrl);
                    session.screenshotBase64 = newScreenshot;
                    session.conversationHistory.push({
                        role: 'user',
                        parts: [
                            {
                                function_response: {
                                    name: session.pendingAction.name,
                                    response: {
                                        url: session.currentUrl || '',
                                        ...result,
                                        safety_acknowledgement: 'true',
                                    },
                                },
                            },
                            {
                                inline_data: {
                                    mime_type: 'image/png',
                                    data: newScreenshot,
                                },
                            },
                        ],
                    } as ConversationTurn);
                }

                session.pendingAction = undefined;
                session.status = 'in_progress';
                session.updatedAt = Date.now();
                await saveSession(session);
                sessionCache.set(sessionId, session);

                // Continue processing with safety acknowledgement via QStash
                if (qstash) {
                    await qstash.publishJSON({
                        url: buildQStashUrl('process-turn'),
                        body: { sessionId, safetyAcknowledged: true },
                        retries: 3,
                    });
                } else {
                    await processNextTurn(sessionId, true);
                }

                return json({ sessionId, status: 'in_progress' });
            }

            case 'cancel': {
                if (request.method !== 'POST') return error('Method not allowed', 405);

                const body = await request.json();
                const sessionId = (body.sessionId || '').toString().trim();

                if (!sessionId) return error('Missing sessionId', 400);

                const session = sessionCache.get(sessionId) || await getSession(sessionId);
                if (!session) return error('Session not found', 404);

                session.status = 'cancelled';
                session.updatedAt = Date.now();
                await saveSession(session);
                // Clean up Browserbase session to free concurrent slot
                await closeBrowserbaseSession(session.browserbaseSessionId);

                return json({ sessionId, status: 'cancelled' });
            }

            case 'send-command': {
                // Send a follow-up command to an existing session (session reuse)
                if (request.method !== 'POST') return error('Method not allowed', 405);

                const body = await request.json();
                const sessionId = (body.sessionId || '').toString().trim();
                const command = (body.command || '').toString().trim();

                if (!sessionId) return error('Missing sessionId', 400);
                if (!command) return error('Missing command', 400);

                const session = sessionCache.get(sessionId) || await getSession(sessionId);
                if (!session) return error('Session not found', 404);

                // Check if session is still active
                if (['completed', 'failed', 'cancelled'].includes(session.status)) {
                    return error(`Session is ${session.status}, cannot send new commands`, 400);
                }

                console.log(`[ComputerUse] Sending command to session ${sessionId}: "${command.substring(0, 100)}..."`);

                // Take a screenshot of current state
                let screenshotBase64 = session.screenshotBase64 || '';
                try {
                    if (session.browserbaseConnectUrl) {
                        screenshotBase64 = await getBrowserbaseScreenshot(session.browserbaseConnectUrl);
                    }
                } catch (e) {
                    console.error('[ComputerUse] Failed to get screenshot for command:', e);
                }

                // Add new user command to conversation history
                const newCommandParts: any[] = [{ text: `User's follow-up instruction: ${command}` }];
                if (screenshotBase64) {
                    newCommandParts.push({
                        inline_data: {
                            mime_type: 'image/png',
                            data: screenshotBase64,
                        },
                    });
                }
                session.conversationHistory.push({ role: 'user', parts: newCommandParts });

                // Update session state
                session.status = 'in_progress';
                session.goal = command; // Update goal to new command
                session.updatedAt = Date.now();
                session.screenshotBase64 = screenshotBase64;
                await saveSession(session);
                sessionCache.set(sessionId, session);

                // Process the new command
                if (qstash) {
                    await qstash.publishJSON({
                        url: buildQStashUrl('process-turn'),
                        body: { sessionId },
                        retries: 3,
                    });
                } else {
                    await processNextTurn(sessionId);
                }

                return json({
                    ...session,
                    sessionId,
                    status: 'in_progress',
                    message: 'Command sent to session',
                });
            }

            case 'process-turn': {
                // QStash callback endpoint - runs one turn of the agent loop
                if (request.method !== 'POST') return error('Method not allowed', 405);

                // Note: In production, verify QStash signature using QSTASH_CURRENT_SIGNING_KEY
                // For now, we'll trust the request if it's well-formed
                const body = await request.json();
                const sessionId = (body.sessionId || '').toString().trim();
                const safetyAcknowledged = body.safetyAcknowledged === true;

                console.log(`[ComputerUse] QStash process-turn called for session ${sessionId}`);

                if (!sessionId) return error('Missing sessionId', 400);

                // Run one turn of the agent loop
                await processNextTurn(sessionId, safetyAcknowledged);

                // Get updated session state
                const session = sessionCache.get(sessionId) || await getSession(sessionId);

                return json({
                    sessionId,
                    status: session?.status || 'unknown',
                    turns: session?.turns || 0,
                });
            }

            default:
                return error('Unknown operation', 400);
        }
    },
};

async function processNextTurn(sessionId: string, safetyAcknowledged = false): Promise<void> {
    console.log(`[ComputerUse] processNextTurn called for session ${sessionId}, safetyAcknowledged=${safetyAcknowledged}`);

    let session = sessionCache.get(sessionId) || await getSession(sessionId);
    if (!session) {
        console.error(`[ComputerUse] Session ${sessionId} not found!`);
        return;
    }
    if (session.status !== 'in_progress') {
        console.log(`[ComputerUse] Session ${sessionId} status is ${session.status}, not processing`);
        return;
    }

    if (session.turns >= MAX_TURNS) {
        session.status = 'completed';
        session.finalResult = 'Maximum turns reached. The task may be partially complete.';
        session.updatedAt = Date.now();
        await saveSession(session);
        // Clean up Browserbase session to free concurrent slot
        await closeBrowserbaseSession(session.browserbaseSessionId);
        return;
    }

    try {
        // Get screenshot
        if (!session.browserbaseConnectUrl) throw new Error('No browser session');
        console.log(`[ComputerUse] Getting screenshot for session ${sessionId}`);
        const screenshotBase64 = await getBrowserbaseScreenshot(session.browserbaseConnectUrl);
        session.screenshotBase64 = screenshotBase64; // Store full screenshot for frontend
        session.currentUrl = await getBrowserbaseCurrentUrl(session.browserbaseConnectUrl) || session.currentUrl;
        console.log(`[ComputerUse] Screenshot captured, currentUrl=${session.currentUrl}`);

        // Call Computer Use model (conversation history already has all previous turns)
        console.log(`[ComputerUse] Calling model for session ${sessionId}, turn ${session.turns + 1}, goal: ${session.goal.substring(0, 100)}...`);
        console.log(`[ComputerUse] Conversation history has ${session.conversationHistory.length} turns`);
        const response = await callComputerUseModel(session, screenshotBase64);
        console.log(`[ComputerUse] Model response: done=${response.done}, functionCalls=${response.functionCalls?.length || 0}, text=${response.text?.substring(0, 100) || 'none'}`);
        session.turns++;
        session.updatedAt = Date.now();

        // Store model's thoughts for debugging
        if (response.thoughts) {
            session.modelThoughts = response.thoughts;
        }

        // Add model response to conversation history
        if (response.modelContent) {
            session.conversationHistory.push(response.modelContent);
        }

        if (response.done) {
            session.status = 'completed';
            session.finalResult = response.text || 'Task completed successfully.';
            await saveSession(session);
            sessionCache.set(sessionId, session);
            // Clean up Browserbase session to free concurrent slot
            await closeBrowserbaseSession(session.browserbaseSessionId);
            return;
        }

        if (!response.functionCalls || response.functionCalls.length === 0) {
            session.status = 'completed';
            session.finalResult = response.text || 'No further actions needed.';
            await saveSession(session);
            sessionCache.set(sessionId, session);
            // Clean up Browserbase session to free concurrent slot
            await closeBrowserbaseSession(session.browserbaseSessionId);
            return;
        }

        // Execute function calls
        const executedResults: Array<{ name: string; result: any }> = [];

        for (const fc of response.functionCalls) {
            // Check for safety decision
            const safetyDecision = fc.args.safety_decision;
            if (safetyDecision?.decision === 'require_confirmation') {
                session.status = 'awaiting_confirmation';
                session.pendingAction = {
                    name: fc.name,
                    args: fc.args,
                    safetyDecision,
                };
                await saveSession(session);
                sessionCache.set(sessionId, session);
                return;
            }

            // Execute action
            console.log(`[ComputerUse] Executing action: ${fc.name} with args: ${JSON.stringify(fc.args).substring(0, 200)}`);
            const result = await executeBrowserbaseAction(session.browserbaseConnectUrl!, fc);
            console.log(`[ComputerUse] Action ${fc.name} result: success=${result.success}, url=${result.url}, error=${result.error || 'none'}`);
            session.actions.push({
                name: fc.name,
                timestamp: Date.now(),
                result,
            });
            executedResults.push({ name: fc.name, result });
            session.currentUrl = result.url || session.currentUrl;

            if (!result.success) {
                console.error(`Action ${fc.name} failed:`, result.error);
            }
        }

        // Add function responses to conversation history
        if (executedResults.length > 0) {
            const newScreenshot = await getBrowserbaseScreenshot(session.browserbaseConnectUrl!);
            session.screenshotBase64 = newScreenshot;

            // Per Google docs: function_response and screenshot (inline_data) should be sibling parts
            const functionResponseParts: ConversationPart[] = [];

            // Add each function_response as a separate part
            for (const er of executedResults) {
                functionResponseParts.push({
                    function_response: {
                        name: er.name,
                        response: {
                            url: session.currentUrl || '',
                            ...er.result,
                        },
                    },
                });
            }

            // Add screenshot as a sibling part (after all function_responses)
            functionResponseParts.push({
                inline_data: {
                    mime_type: 'image/png',
                    data: newScreenshot,
                },
            });

            session.conversationHistory.push({
                role: 'user',
                parts: functionResponseParts,
            });
        }

        // Save session state and update cache before continuing
        await saveSession(session);
        sessionCache.set(sessionId, session);

        // Queue next turn via QStash (each turn runs in separate serverless invocation)
        if (qstash) {
            await qstash.publishJSON({
                url: buildQStashUrl('process-turn'),
                body: { sessionId },
                retries: 3,
                delay: 1, // 1 second delay between turns
            });
            console.log(`[ComputerUse] Queued next turn via QStash for session ${sessionId}, turn ${session.turns}`);
        } else {
            // Fallback: small delay then continue (may hit timeout)
            await new Promise(resolve => setTimeout(resolve, 1500));
            await processNextTurn(sessionId);
        }
    } catch (e: any) {
        session.status = 'failed';
        session.error = e.message || 'Unknown error occurred during browser automation.';
        session.updatedAt = Date.now();
        await saveSession(session);
        sessionCache.set(sessionId, session);
        console.error('Computer Use turn failed:', e);
        // Clean up Browserbase session to free concurrent slot
        await closeBrowserbaseSession(session.browserbaseSessionId);
    }
}
