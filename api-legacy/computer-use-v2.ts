/**
 * Computer Use Agent V2 - Clean Implementation
 * 
 * Based on official Google Gemini Computer Use documentation:
 * https://ai.google.dev/gemini-api/docs/computer-use
 * 
 * Key differences from V1:
 * 1. Initial prompt MUST include screenshot
 * 2. Coordinates use 0-999 normalized grid (denormalize to actual pixels)
 * 3. Proper agent loop with function_response for each action
 * 4. All 12 supported UI actions implemented
 */

import { chromium, Browser, Page } from 'playwright-core';

// ============================================================================
// CONSTANTS
// ============================================================================

const COMPUTER_USE_MODEL = 'gemini-2.5-computer-use-preview-10-2025';
const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
const GENERATE_CONTENT_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${COMPUTER_USE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Mobile viewport for better display in chat window
const SCREEN_WIDTH = 360;
const SCREEN_HEIGHT = 800;

// Browserbase credentials
const browserbaseApiKey = process.env.BROWSERBASE_API_KEY || '';
const browserbaseProjectId = process.env.BROWSERBASE_PROJECT_ID || '';

// Maximum turns in the agent loop to prevent infinite loops
const MAX_AGENT_TURNS = 25;

// Only keep screenshots in the N most recent turns to reduce token usage
const MAX_RECENT_TURNS_WITH_SCREENSHOTS = 3;

// ============================================================================
// SYSTEM INSTRUCTION
// ============================================================================

const SYSTEM_INSTRUCTION = `You are a browser automation agent. Your job is to complete the user's task by interacting with the web browser.

IMPORTANT: The browser is ALREADY OPEN and you are looking at a screenshot of the current page. Do NOT use open_web_browser - it's already open!

CRITICAL RULES:
1. ALWAYS take actions to accomplish the user's goal. Do NOT just respond with text unless you have FULLY completed the task.
2. The screenshot shows the CURRENT state of the browser. Analyze it carefully!
3. Use click_at, type_text_at, scroll_document, etc. to interact with the page.
4. After each action, you will receive a new screenshot showing the result. ANALYZE IT and continue with the next required action.
5. Continue taking actions until the ENTIRE task is complete - not just the first step.
6. When the task is FULLY complete, provide a summary of what you accomplished.

IMPORTANT: If the user asks to "search for X on Y website":
- First navigate to the website if not already there
- Find the search box/field on the page
- Click on the search box
- Type the search query
- Press Enter or click the search button
- WAIT for results to load
- Only then is the task complete

AVAILABLE ACTIONS:
- navigate: Go directly to a URL
- click_at: Click at a specific coordinate (x, y between 0-999)
- type_text_at: Type text at a specific coordinate (use press_enter: true to submit)
- scroll_document: Scroll the page up/down/left/right
- scroll_at: Scroll at a specific coordinate
- key_combination: Press keyboard keys (e.g., "Enter", "Control+A")
- go_back: Go to the previous page
- go_forward: Go to the next page
- wait_5_seconds: Wait for content to load
- hover_at: Hover at a specific coordinate

COORDINATE SYSTEM:
- Coordinates are normalized from 0 to 999
- (0, 0) is the top-left corner
- (999, 999) is the bottom-right corner
- Estimate coordinates based on the visual position in the screenshot

BEST PRACTICES:
1. If you need to search, FIRST click on the search box, THEN use type_text_at with the search query
2. Use press_enter: true in type_text_at to submit searches
3. Wait for pages to load before taking the next action
4. If something doesn't work, try an alternative approach
5. Be precise with click coordinates - aim for the center of the target element
6. NEVER stop after just navigating - continue with the full task`;

// ============================================================================
// URL EXTRACTION FROM GOAL
// ============================================================================

/**
 * Quick regex-based extraction to get initial URL from user's goal.
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
        'etsy': 'https://www.etsy.com',
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
        // Real estate
        'zillow': 'https://www.zillow.com',
        // News
        'cnn': 'https://www.cnn.com',
        'bbc': 'https://www.bbc.com',
        // Tech
        'github': 'https://www.github.com',
        'stackoverflow': 'https://stackoverflow.com',
        // Reference
        'wikipedia': 'https://www.wikipedia.org',
        'yelp': 'https://www.yelp.com',
        // Google
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

// ============================================================================
// TYPES
// ============================================================================

interface ComputerUseSession {
    id: string;
    status: 'starting' | 'in_progress' | 'awaiting_confirmation' | 'completed' | 'failed' | 'cancelled';
    goal: string;
    browserbaseSessionId: string;
    browserbaseConnectUrl: string;
    liveViewUrl?: string;
    currentUrl: string;
    screenshotBase64: string;
    conversationHistory: any[];
    actions: ActionRecord[];
    pendingAction?: PendingAction;
    currentTurn: number;
    finalResult?: string;
    error?: string;
    thoughts: string[];
    createdAt: number;
    updatedAt: number;
}

interface ActionRecord {
    name: string;
    args: any;
    timestamp: number;
    result?: any;
    error?: string;
}

interface PendingAction {
    name: string;
    args: any;
    safetyExplanation?: string;
}

interface FunctionCall {
    name: string;
    args: Record<string, any>;
}

// ============================================================================
// FIRESTORE SESSION STORAGE (lazy initialization)
// ============================================================================

let firestoreInitialized = false;

const ensureFirestoreForSessions = async () => {
    if (firestoreInitialized) return;
    firestoreInitialized = true;

    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    if (getApps().length) return;

    // Check for individual credential env vars first
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (clientEmail && privateKey) {
        console.log('[ComputerUseV2] Initializing Firebase with FIREBASE_CLIENT_EMAIL/PRIVATE_KEY');
        initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID || 'ffresearchr',
                clientEmail: clientEmail,
                privateKey: privateKey.replace(/\\n/g, '\n'),
            }),
        });
        return;
    }

    // Try base64-encoded service account JSON
    const base64Json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    if (base64Json) {
        try {
            const decoded = Buffer.from(base64Json, 'base64').toString('utf-8');
            const serviceAccount = JSON.parse(decoded);
            console.log('[ComputerUseV2] Initializing Firebase with FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');
            initializeApp({
                credential: cert({
                    projectId: serviceAccount.project_id || 'ffresearchr',
                    clientEmail: serviceAccount.client_email,
                    privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
                }),
            });
            return;
        } catch (e) {
            console.error('[ComputerUseV2] Failed to parse base64 service account:', e);
        }
    }

    // Try multiple other environment variable names for service account JSON
    const serviceAccountJson =
        process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        process.env.FIREBASE_SERVICE_ACCOUNT ||
        process.env.FIREBASE_ADMIN_CREDENTIALS;

    if (serviceAccountJson) {
        try {
            const serviceAccount = JSON.parse(serviceAccountJson);
            if (serviceAccount.client_email && serviceAccount.private_key) {
                console.log('[ComputerUseV2] Initializing Firebase with service account JSON');
                initializeApp({
                    credential: cert({
                        projectId: serviceAccount.project_id || 'ffresearchr',
                        clientEmail: serviceAccount.client_email,
                        privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
                    }),
                });
                return;
            }
        } catch (e) {
            console.error('[ComputerUseV2] Failed to parse service account JSON:', e);
        }
    }

    // Fallback: initialize without credentials (uses GOOGLE_APPLICATION_CREDENTIALS or default)
    console.log('[ComputerUseV2] Initializing Firebase with default credentials');
    initializeApp();
};

async function getSession(sessionId: string): Promise<ComputerUseSession | null> {
    await ensureFirestoreForSessions();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const doc = await db.collection('computer_use_sessions_v2').doc(sessionId).get();
    if (!doc.exists) return null;

    const data = doc.data() as any;

    // Deserialize conversation history from JSON string
    let conversationHistory: any[] = [];
    if (typeof data.conversationHistory === 'string') {
        try {
            conversationHistory = JSON.parse(data.conversationHistory);
        } catch {
            conversationHistory = [];
        }
    } else if (Array.isArray(data.conversationHistory)) {
        conversationHistory = data.conversationHistory;
    }

    const actions = typeof data.actions === 'string' ? JSON.parse(data.actions || '[]') : data.actions || [];
    const thoughts = typeof data.thoughts === 'string' ? JSON.parse(data.thoughts || '[]') : data.thoughts || [];
    const pendingAction = typeof data.pendingAction === 'string' ? JSON.parse(data.pendingAction) : data.pendingAction;

    return {
        ...data,
        conversationHistory,
        actions,
        thoughts,
        pendingAction,
        createdAt: data.createdAt?.toMillis?.() || data.createdAt,
        updatedAt: data.updatedAt?.toMillis?.() || data.updatedAt,
    } as ComputerUseSession;
}

async function saveSession(session: ComputerUseSession): Promise<void> {
    await ensureFirestoreForSessions();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();

    // Exclude screenshotBase64 from Firestore (too large - 1MB limit)
    // Screenshot is kept in memory and returned to frontend via API responses
    const { screenshotBase64, ...sessionWithoutScreenshot } = session;

    const serializedSession = {
        ...sessionWithoutScreenshot,
        conversationHistory: JSON.stringify(session.conversationHistory || []),
        actions: JSON.stringify(session.actions || []),
        thoughts: JSON.stringify(session.thoughts || []),
        pendingAction: session.pendingAction ? JSON.stringify(session.pendingAction) : null,
        updatedAt: new Date(),
    };

    await db.collection('computer_use_sessions_v2').doc(session.id).set(serializedSession);
}

// ============================================================================
// BROWSERBASE SESSION MANAGEMENT
// ============================================================================

async function createBrowserbaseSession(): Promise<{ sessionId: string; connectUrl: string }> {
    if (!browserbaseApiKey || !browserbaseProjectId) {
        throw new Error('Browserbase credentials not configured');
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const res = await fetch('https://api.browserbase.com/v1/sessions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-bb-api-key': browserbaseApiKey,
                },
                body: JSON.stringify({
                    projectId: browserbaseProjectId,
                    keepAlive: true,
                    timeout: 300, // 5 minute session
                    browserSettings: {
                        fingerprint: {
                            devices: ['mobile'],
                            locales: ['en-US'],
                            operatingSystems: ['android'],
                        },
                        viewport: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
                    },
                }),
            });

            if (res.ok) {
                const data = await res.json();
                console.log(`[ComputerUseV2] Created Browserbase session: ${data.id}`);
                return { sessionId: data.id, connectUrl: data.connectUrl };
            }

            if (res.status === 429) {
                const waitTime = Math.pow(2, attempt) * 1000;
                console.log(`[ComputerUseV2] Rate limited, waiting ${waitTime}ms...`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            throw new Error(`Browserbase API error: ${res.status}`);
        } catch (e) {
            lastError = e as Error;
            console.error(`[ComputerUseV2] Attempt ${attempt + 1} failed:`, e);
        }
    }

    throw lastError || new Error('Failed to create Browserbase session');
}

async function closeBrowserbaseSession(sessionId: string): Promise<void> {
    if (!browserbaseApiKey || !browserbaseProjectId || !sessionId) return;

    try {
        console.log(`[ComputerUseV2] Closing Browserbase session ${sessionId}`);
        await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-bb-api-key': browserbaseApiKey,
            },
            body: JSON.stringify({
                projectId: browserbaseProjectId,
                status: 'REQUEST_RELEASE',
            }),
        });
    } catch (e) {
        console.error(`[ComputerUseV2] Error closing session:`, e);
    }
}

async function getLiveViewUrl(sessionId: string): Promise<string | null> {
    if (!browserbaseApiKey) return null;

    try {
        const res = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/debug`, {
            headers: { 'x-bb-api-key': browserbaseApiKey },
        });

        if (!res.ok) return null;

        const data = await res.json();
        const url = data.debuggerFullscreenUrl || data.debuggerUrl;
        return url ? `${url}&navbar=false` : null;
    } catch (e) {
        return null;
    }
}

// ============================================================================
// BROWSER ACTIONS (PLAYWRIGHT)
// ============================================================================

/**
 * Denormalize X coordinate from 0-999 to actual screen width
 */
function denormalizeX(x: number): number {
    return Math.round((x / 1000) * SCREEN_WIDTH);
}

/**
 * Denormalize Y coordinate from 0-999 to actual screen height
 */
function denormalizeY(y: number): number {
    return Math.round((y / 1000) * SCREEN_HEIGHT);
}

/**
 * Connect to Browserbase and get page
 */
async function connectToBrowser(connectUrl: string): Promise<{ browser: Browser; page: Page }> {
    console.log(`[ComputerUseV2] Connecting to browser via CDP...`);
    const startTime = Date.now();

    try {
        const browser = await chromium.connectOverCDP(connectUrl, { timeout: 30000 });
        console.log(`[ComputerUseV2] CDP connection established in ${Date.now() - startTime}ms`);

        const contexts = browser.contexts();
        const context = contexts[0] || await browser.newContext({
            viewport: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
        });
        const pages = context.pages();
        const page = pages[0] || await context.newPage();

        console.log(`[ComputerUseV2] Browser page ready in ${Date.now() - startTime}ms total`);
        return { browser, page };
    } catch (error) {
        console.error(`[ComputerUseV2] Failed to connect to browser after ${Date.now() - startTime}ms:`, error);
        throw error;
    }
}

/**
 * Take a screenshot of the current page
 */
async function takeScreenshot(connectUrl: string): Promise<{ screenshot: string; url: string }> {
    const { browser, page } = await connectToBrowser(connectUrl);

    try {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
        const screenshot = screenshotBuffer.toString('base64');
        const url = page.url();
        return { screenshot, url };
    } catch {
        return { screenshot: '', url: '' };
    }
}

/**
 * Execute a function call from the model
 */
async function executeAction(
    connectUrl: string,
    functionCall: FunctionCall
): Promise<{ success: boolean; url: string; screenshot: string; error?: string }> {
    const { browser, page } = await connectToBrowser(connectUrl);
    const { name, args } = functionCall;

    console.log(`[ComputerUseV2] Executing action: ${name}`, args);

    try {
        switch (name) {
            case 'open_web_browser':
                // No-op - browser is already open
                break;

            case 'wait_5_seconds':
                await page.waitForTimeout(5000);
                break;

            case 'go_back':
                await page.goBack({ timeout: 30000 }).catch(() => { });
                break;

            case 'go_forward':
                await page.goForward({ timeout: 30000 }).catch(() => { });
                break;

            case 'search':
                await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
                break;

            case 'navigate': {
                let url = args.url as string;
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'https://' + url;
                }
                console.log(`[ComputerUseV2] Navigating to: ${url}`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                break;
            }

            case 'click_at': {
                const x = denormalizeX(args.x);
                const y = denormalizeY(args.y);
                console.log(`[ComputerUseV2] Clicking at (${x}, ${y})`);
                await page.mouse.click(x, y);
                await page.waitForTimeout(500);
                break;
            }

            case 'hover_at': {
                const x = denormalizeX(args.x);
                const y = denormalizeY(args.y);
                await page.mouse.move(x, y);
                await page.waitForTimeout(300);
                break;
            }

            case 'type_text_at': {
                const x = denormalizeX(args.x);
                const y = denormalizeY(args.y);
                const text = args.text as string;
                const pressEnter = args.press_enter !== false;
                const clearFirst = args.clear_before_typing !== false;

                console.log(`[ComputerUseV2] Typing "${text}" at (${x}, ${y})`);

                // Strategy: Click first to focus, then use fill on the active element
                // This is better than elementFromPoint because click handles overlays/labels
                await page.mouse.click(x, y);
                await page.waitForTimeout(500); // Wait for focus events/animations

                let usedSmartFill = false;
                try {
                    // Check what element has focus
                    const activeElement = await page.evaluateHandle(() => document.activeElement);

                    const isEditable = await activeElement.evaluate(el => {
                        if (!el) return false;
                        const tagName = el.tagName;
                        const isContentEditable = (el as HTMLElement).isContentEditable;
                        return tagName === 'INPUT' || tagName === 'TEXTAREA' || isContentEditable;
                    });

                    if (isEditable) {
                        const tagName = await activeElement.evaluate(el => el?.tagName);
                        console.log(`[ComputerUseV2] Focused element is ${tagName}, using fill()`);

                        // fill() is extremely robust (atomic set + events)
                        await activeElement.asElement()?.fill(text);
                        usedSmartFill = true;
                    }
                } catch (e) {
                    console.warn('[ComputerUseV2] Smart focus check failed', e);
                }

                if (usedSmartFill) {
                    if (pressEnter) {
                        await page.waitForTimeout(500);
                        await page.keyboard.press('Enter');
                    }
                    await page.waitForTimeout(1000);
                    break;
                }

                // FALLBACK: If smart fill didn't work (e.g. custom canvas, or focus failed)
                console.log('[ComputerUseV2] Using fallback click+type strategy');

                // Click one more time to be sure
                await page.mouse.click(x, y);
                await page.waitForTimeout(300);

                if (clearFirst) {
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await page.waitForTimeout(200);
                }

                await page.keyboard.type(text, { delay: 100 });

                if (pressEnter) {
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Enter');
                }

                await page.waitForTimeout(1000);
                break;
            }

            case 'key_combination': {
                const keys = args.keys as string;
                console.log(`[ComputerUseV2] Pressing keys: ${keys}`);
                await page.keyboard.press(keys);
                await page.waitForTimeout(300);
                break;
            }

            case 'scroll_document': {
                const direction = args.direction as string;
                const scrollAmount = 400;

                switch (direction) {
                    case 'up':
                        await page.mouse.wheel(0, -scrollAmount);
                        break;
                    case 'down':
                        await page.mouse.wheel(0, scrollAmount);
                        break;
                    case 'left':
                        await page.mouse.wheel(-scrollAmount, 0);
                        break;
                    case 'right':
                        await page.mouse.wheel(scrollAmount, 0);
                        break;
                }
                await page.waitForTimeout(500);
                break;
            }

            case 'scroll_at': {
                const x = denormalizeX(args.x);
                const y = denormalizeY(args.y);
                const direction = args.direction as string;
                const magnitude = args.magnitude ? denormalizeY(args.magnitude) : 400;

                await page.mouse.move(x, y);

                switch (direction) {
                    case 'up':
                        await page.mouse.wheel(0, -magnitude);
                        break;
                    case 'down':
                        await page.mouse.wheel(0, magnitude);
                        break;
                    case 'left':
                        await page.mouse.wheel(-magnitude, 0);
                        break;
                    case 'right':
                        await page.mouse.wheel(magnitude, 0);
                        break;
                }
                await page.waitForTimeout(500);
                break;
            }

            case 'drag_and_drop': {
                const startX = denormalizeX(args.x);
                const startY = denormalizeY(args.y);
                const endX = denormalizeX(args.destination_x);
                const endY = denormalizeY(args.destination_y);

                await page.mouse.move(startX, startY);
                await page.mouse.down();
                await page.mouse.move(endX, endY, { steps: 10 });
                await page.mouse.up();
                await page.waitForTimeout(500);
                break;
            }

            default:
                console.warn(`[ComputerUseV2] Unknown action: ${name}`);
        }

        // Wait for any navigation/rendering to complete
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        await page.waitForTimeout(1000);

        // Take screenshot of result
        const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
        const screenshot = screenshotBuffer.toString('base64');
        const url = page.url();

        return { success: true, url, screenshot };
    } catch (error) {
        console.error(`[ComputerUseV2] Action error:`, error);

        // Still try to get screenshot even if action failed
        try {
            const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
            const screenshot = screenshotBuffer.toString('base64');
            const url = page.url();
            return { success: false, url, screenshot, error: String(error) };
        } catch {
            return { success: false, url: '', screenshot: '', error: String(error) };
        }
    }
}

// ============================================================================
// GEMINI MODEL INTERACTION
// ============================================================================

/**
 * Call the Gemini Computer Use model
 */
async function callModel(contents: any[]): Promise<{
    text?: string;
    functionCalls: FunctionCall[];
    safetyDecision?: { decision: string; explanation: string };
    done: boolean;
    malformedFunctionCall?: boolean;
}> {
    const requestBody = {
        contents,
        tools: [{
            computer_use: {
                environment: 'ENVIRONMENT_BROWSER',
            },
        }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
        },
        systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
        },
    };

    console.log(`[ComputerUseV2] Calling model with ${contents.length} content items`);

    const response = await fetch(GENERATE_CONTENT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ComputerUseV2] Model API error:`, response.status, errorText);
        throw new Error(`Model API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    // Check for malformed function call finish reason - caller should retry
    const finishReason = candidate?.finishReason;
    if (finishReason === 'MALFORMED_FUNCTION_CALL') {
        console.log('[ComputerUseV2] Got MALFORMED_FUNCTION_CALL, will retry');
        return { functionCalls: [], done: false, malformedFunctionCall: true };
    }

    if (!candidate?.content?.parts) {
        console.log('[ComputerUseV2] No content in response');
        return { functionCalls: [], done: true };
    }

    const parts = candidate.content.parts;
    let text: string | undefined;
    const functionCalls: FunctionCall[] = [];
    let safetyDecision: { decision: string; explanation: string } | undefined;

    console.log(`[ComputerUseV2] Response has ${parts.length} parts, finishReason: ${finishReason}`);

    for (const part of parts) {
        if (part.text) {
            text = part.text;
            console.log(`[ComputerUseV2] Model text (first 300 chars): ${text.substring(0, 300)}...`);
        }
        if (part.functionCall) {
            const fc = part.functionCall;
            functionCalls.push({ name: fc.name, args: fc.args || {} });

            // Check for safety decision in args
            if (fc.args?.safety_decision) {
                safetyDecision = {
                    decision: fc.args.safety_decision.decision,
                    explanation: fc.args.safety_decision.explanation,
                };
                console.log(`[ComputerUseV2] Safety decision required: ${safetyDecision.explanation}`);
            }

            console.log(`[ComputerUseV2] Function call: ${fc.name}`, JSON.stringify(fc.args).substring(0, 200));
        }
    }

    // If no function calls, the model is done
    const done = functionCalls.length === 0;
    console.log(`[ComputerUseV2] Model response: ${functionCalls.length} function calls, done=${done}, hasText=${!!text}`);

    return { text, functionCalls, safetyDecision, done };
}

// ============================================================================
// AGENT LOOP
// ============================================================================

/**
 * Run one turn of the agent loop
 */
async function runAgentTurn(session: ComputerUseSession): Promise<ComputerUseSession> {
    console.log(`[ComputerUseV2] === Turn ${session.currentTurn + 1} ===`);

    // Call the model
    const modelResponse = await callModel(session.conversationHistory);

    // Store any thoughts/text from the model
    if (modelResponse.text) {
        session.thoughts.push(modelResponse.text);
    }

    // If done (no function calls), mark as complete
    if (modelResponse.done) {
        console.log('[ComputerUseV2] Model indicated task complete');
        session.status = 'completed';
        session.finalResult = modelResponse.text || 'Task completed';
        return session;
    }

    // Handle malformed function call - retry the request without executing
    if (modelResponse.malformedFunctionCall) {
        console.log('[ComputerUseV2] Retrying due to malformed function call');
        session.currentTurn++;
        return session;
    }

    // Check for safety confirmation requirement
    if (modelResponse.safetyDecision?.decision === 'require_confirmation') {
        console.log('[ComputerUseV2] Safety confirmation required');
        session.status = 'awaiting_confirmation';
        session.pendingAction = {
            name: modelResponse.functionCalls[0].name,
            args: modelResponse.functionCalls[0].args,
            safetyExplanation: modelResponse.safetyDecision.explanation,
        };
        return session;
    }

    // Execute each function call and collect responses
    const functionResponses: any[] = [];

    console.log(`[ComputerUseV2] Executing ${modelResponse.functionCalls.length} function calls...`);

    for (const fc of modelResponse.functionCalls) {
        console.log(`[ComputerUseV2] About to execute: ${fc.name}`);

        // Record the action
        const actionRecord: ActionRecord = {
            name: fc.name,
            args: fc.args,
            timestamp: Date.now(),
        };

        try {
            // Execute the action
            const result = await executeAction(session.browserbaseConnectUrl, fc);
            console.log(`[ComputerUseV2] Action ${fc.name} completed: success=${result.success}, url=${result.url}`);

            actionRecord.result = result.success ? { url: result.url } : undefined;
            actionRecord.error = result.error;
            session.actions.push(actionRecord);

            // Update session state
            session.currentUrl = result.url;
            session.screenshotBase64 = result.screenshot;

            // Build function response per official Google SDK documentation
            // The screenshot MUST be inside functionResponse.parts as FunctionResponsePart
            // Reference: https://github.com/google-gemini/computer-use-preview/blob/main/agent.py
            const functionResponseObj: any = {
                functionResponse: {
                    name: fc.name,
                    response: { url: result.url, success: result.success },
                },
            };

            // Add screenshot INSIDE functionResponse.parts (NOT as separate user message part)
            // This matches the Python SDK structure: FunctionResponse.parts = [FunctionResponsePart(inline_data=...)]
            if (result.screenshot) {
                functionResponseObj.functionResponse.parts = [{
                    inlineData: {
                        mimeType: 'image/png',
                        data: result.screenshot,
                    },
                }];
            }

            functionResponses.push(functionResponseObj);
            console.log(`[ComputerUseV2] Added function response for ${fc.name} with screenshot: ${!!result.screenshot}`);
        } catch (actionError) {
            console.error(`[ComputerUseV2] Error executing action ${fc.name}:`, actionError);
            actionRecord.error = String(actionError);
            session.actions.push(actionRecord);
            throw actionError; // Re-throw to be caught by the outer loop
        }
    }

    // Add model response to conversation history
    session.conversationHistory.push({
        role: 'model',
        parts: modelResponse.functionCalls.map(fc => ({
            functionCall: { name: fc.name, args: fc.args },
        })),
    });

    // Add function responses to conversation history
    session.conversationHistory.push({
        role: 'user',
        parts: functionResponses,
    });

    // Prune screenshots from older turns to reduce token usage
    // Only keep screenshots in the N most recent turns
    let turnsWithScreenshots = 0;
    for (let i = session.conversationHistory.length - 1; i >= 0; i--) {
        const content = session.conversationHistory[i];
        if (content.role === 'user' && content.parts) {
            // Check if any part has a screenshot (either in functionResponse.parts or as direct inlineData)
            let hasScreenshot = false;
            const partsArray = content.parts as any[];
            for (const part of partsArray) {
                // Check for screenshot in functionResponse.parts (from action results)
                if (part.functionResponse?.parts) {
                    hasScreenshot = true;
                    break;
                }
                // Also check for direct inlineData (from initial screenshot)
                if (part.inlineData) {
                    hasScreenshot = true;
                    break;
                }
            }
            if (hasScreenshot) {
                turnsWithScreenshots++;
                // Remove screenshots from turns beyond the limit
                if (turnsWithScreenshots > MAX_RECENT_TURNS_WITH_SCREENSHOTS) {
                    for (const part of partsArray) {
                        if (part.functionResponse?.parts) {
                            part.functionResponse.parts = null;
                        }
                    }
                    // Filter out direct inlineData parts from old initial messages
                    content.parts = partsArray.filter(part => !part.inlineData);
                }
            }
        }
    }

    console.log(`[ComputerUseV2] Turn ${session.currentTurn + 1} complete. Status: ${session.status}, Actions: ${session.actions.length}`);

    session.currentTurn++;
    session.updatedAt = Date.now();

    return session;
}

/**
 * Run the full agent loop
 */
async function runAgentLoop(session: ComputerUseSession): Promise<ComputerUseSession> {
    console.log(`[ComputerUseV2] ===== STARTING AGENT LOOP for session ${session.id} =====`);
    console.log(`[ComputerUseV2] Initial status: ${session.status}, currentTurn: ${session.currentTurn}, MAX_TURNS: ${MAX_AGENT_TURNS}`);

    while (
        session.status === 'in_progress' &&
        session.currentTurn < MAX_AGENT_TURNS
    ) {
        console.log(`[ComputerUseV2] Loop iteration - status: ${session.status}, turn: ${session.currentTurn}`);
        try {
            session = await runAgentTurn(session);
            console.log(`[ComputerUseV2] After runAgentTurn - status: ${session.status}, turn: ${session.currentTurn}`);
            await saveSession(session);

            // Check if we need to stop
            if (session.status !== 'in_progress') {
                console.log(`[ComputerUseV2] Exiting loop because status is: ${session.status}`);
                break;
            }
        } catch (error) {
            console.error(`[ComputerUseV2] Agent loop error:`, error);
            session.status = 'failed';
            session.error = String(error);
            await saveSession(session);
            break;
        }
    }

    if (session.currentTurn >= MAX_AGENT_TURNS && session.status === 'in_progress') {
        console.log('[ComputerUseV2] Max turns reached');
        session.status = 'completed';
        session.finalResult = 'Maximum turns reached. ' + (session.thoughts[session.thoughts.length - 1] || '');
    }

    console.log(`[ComputerUseV2] ===== AGENT LOOP ENDED for session ${session.id} - final status: ${session.status} =====`);
    return session;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const json = (data: any, status = 200): Response =>
    new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });

const error = (message: string, status = 400): Response => json({ error: message }, status);

// ============================================================================
// API HANDLER
// ============================================================================

export default {
    async fetch(request: Request): Promise<Response> {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                },
            });
        }

        const url = new URL(request.url);
        const action = url.searchParams.get('action') || 'status';

        try {
            switch (action) {
                // =====================================================
                // START: Create new session and begin agent loop
                // =====================================================
                case 'start': {
                    if (request.method !== 'POST') {
                        return error('Method not allowed', 405);
                    }

                    const body = await request.json().catch(() => ({}));
                    const { goal, initialUrl } = body as { goal?: string; initialUrl?: string };
                    if (!goal) {
                        return error('Missing goal', 400);
                    }

                    console.log(`[ComputerUseV2] Starting session with goal: ${goal}`);

                    // Create Browserbase session
                    const { sessionId: bbSessionId, connectUrl } = await createBrowserbaseSession();

                    // Extract initial URL from goal or use provided initialUrl
                    const extractedUrl = extractUrlFromGoal(goal);
                    const startUrl = initialUrl || extractedUrl || 'https://www.google.com';
                    console.log(`[ComputerUseV2] Navigating to: ${startUrl} (extracted: ${extractedUrl || 'none'})`);

                    const { browser, page } = await connectToBrowser(connectUrl);
                    try {
                        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await page.waitForTimeout(1500);
                    } catch (e) {
                        console.error('[ComputerUseV2] Navigation error:', e);
                    }

                    // Take initial screenshot
                    const { screenshot, url: currentUrl } = await takeScreenshot(connectUrl);
                    console.log(`[ComputerUseV2] Initial screenshot taken at: ${currentUrl}`);

                    // Get live view URL
                    const liveViewUrl = await getLiveViewUrl(bbSessionId);

                    // Create session with initial prompt INCLUDING screenshot
                    const sessionId = `cu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    const session: ComputerUseSession = {
                        id: sessionId,
                        status: 'in_progress',
                        goal,
                        browserbaseSessionId: bbSessionId,
                        browserbaseConnectUrl: connectUrl,
                        liveViewUrl: liveViewUrl || undefined,
                        currentUrl,
                        screenshotBase64: screenshot,
                        // CRITICAL: Include screenshot with initial user prompt AND context about current state
                        conversationHistory: [{
                            role: 'user',
                            parts: [
                                { text: `TASK: ${goal}\n\nCURRENT STATE: The browser is already open and showing ${currentUrl}. The screenshot below shows what's currently on screen. Analyze it and start taking actions to complete the task. Do NOT use open_web_browser - just interact with the page directly using click_at, type_text_at, etc.` },
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: screenshot,
                                    },
                                },
                            ],
                        }],
                        actions: [],
                        currentTurn: 0,
                        thoughts: [],
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    };

                    await saveSession(session);

                    // Start the agent loop (runs asynchronously)
                    runAgentLoop(session).catch(err => {
                        console.error(`[ComputerUseV2] Agent loop crashed:`, err);
                    });

                    return json({
                        sessionId,
                        status: 'in_progress',
                        liveViewUrl,
                        currentUrl,
                        screenshotBase64: screenshot,
                    });
                }

                // =====================================================
                // STATUS: Get current session state
                // =====================================================
                case 'status': {
                    const sessionId = url.searchParams.get('sessionId');
                    if (!sessionId) {
                        return error('Missing sessionId', 400);
                    }

                    const session = await getSession(sessionId);
                    if (!session) {
                        return error('Session not found', 404);
                    }

                    // HEARTBEAT MECHANISM:
                    // On serverless (Vercel), background loops freeze after response.
                    // If the session is in_progress but hasn't updated in >5s, drive it forward here.
                    if (session.status === 'in_progress' && Date.now() - session.updatedAt > 5000) {
                        console.log(`[ComputerUseV2] Status poll: Session stalled (last update ${Date.now() - session.updatedAt}ms ago). Running next turn...`);

                        // Update timestamp to prevent concurrent runs
                        session.updatedAt = Date.now();
                        await saveSession(session);

                        try {
                            // Run single turn synchronously
                            const updatedSession = await runAgentTurn(session);
                            await saveSession(updatedSession);

                            // Return updated state
                            return json({
                                id: updatedSession.id,
                                status: updatedSession.status,
                                goal: updatedSession.goal,
                                currentUrl: updatedSession.currentUrl,
                                screenshotBase64: updatedSession.screenshotBase64,
                                liveViewUrl: updatedSession.liveViewUrl,
                                actions: updatedSession.actions,
                                thoughts: updatedSession.thoughts,
                                finalResult: updatedSession.finalResult,
                                error: updatedSession.error,
                            });
                        } catch (err) {
                            console.error('[ComputerUseV2] Error running turn from status poll:', err);
                            session.error = String(err);
                            session.status = 'failed';
                            await saveSession(session);
                        }
                    }

                    return json({
                        id: session.id,
                        status: session.status,
                        goal: session.goal,
                        currentUrl: session.currentUrl,
                        screenshotBase64: session.screenshotBase64,
                        liveViewUrl: session.liveViewUrl,
                        actions: session.actions,
                        thoughts: session.thoughts,
                        finalResult: session.finalResult,
                        error: session.error,
                    });
                }

                // =====================================================
                // CONFIRM: Handle safety confirmation
                // =====================================================
                case 'confirm': {
                    if (request.method !== 'POST') {
                        return error('Method not allowed', 405);
                    }

                    const body = await request.json().catch(() => ({}));
                    const { sessionId, confirmed } = body as { sessionId?: string; confirmed?: boolean };
                    if (!sessionId) {
                        return error('Missing sessionId', 400);
                    }

                    const session = await getSession(sessionId);
                    if (!session) {
                        return error('Session not found', 404);
                    }

                    if (session.status !== 'awaiting_confirmation') {
                        return error('Session not awaiting confirmation', 400);
                    }

                    if (!confirmed) {
                        session.status = 'cancelled';
                        await closeBrowserbaseSession(session.browserbaseSessionId);
                        await saveSession(session);
                        return json({ sessionId, status: 'cancelled' });
                    }

                    // User confirmed - execute the pending action with safety acknowledgement
                    if (session.pendingAction) {
                        const result = await executeAction(session.browserbaseConnectUrl, {
                            name: session.pendingAction.name,
                            args: session.pendingAction.args,
                        });

                        session.actions.push({
                            name: session.pendingAction.name,
                            args: session.pendingAction.args,
                            timestamp: Date.now(),
                            result: { url: result.url, safetyAcknowledged: true },
                        });

                        session.currentUrl = result.url;
                        session.screenshotBase64 = result.screenshot;

                        // Add function response with safety acknowledgement
                        session.conversationHistory.push({
                            role: 'user',
                            parts: [
                                {
                                    functionResponse: {
                                        name: session.pendingAction.name,
                                        response: { url: result.url, safety_acknowledgement: 'true' },
                                    },
                                },
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: result.screenshot,
                                    },
                                },
                            ],
                        });

                        session.pendingAction = undefined;
                    }

                    session.status = 'in_progress';
                    session.currentTurn++;
                    await saveSession(session);

                    // Continue agent loop
                    runAgentLoop(session).catch(err => {
                        console.error(`[ComputerUseV2] Agent loop crashed:`, err);
                    });

                    return json({ sessionId, status: 'in_progress' });
                }

                // =====================================================
                // CANCEL: Stop session and release browser
                // =====================================================
                case 'cancel': {
                    if (request.method !== 'POST') {
                        return error('Method not allowed', 405);
                    }

                    const body = await request.json().catch(() => ({}));
                    const { sessionId } = body as { sessionId?: string };
                    if (!sessionId) {
                        return error('Missing sessionId', 400);
                    }

                    const session = await getSession(sessionId);
                    if (!session) {
                        return error('Session not found', 404);
                    }

                    session.status = 'cancelled';
                    await saveSession(session);
                    await closeBrowserbaseSession(session.browserbaseSessionId);

                    return json({ sessionId, status: 'cancelled' });
                }

                // =====================================================
                // SEND-COMMAND: Send follow-up command to existing session
                // =====================================================
                case 'send-command': {
                    if (request.method !== 'POST') {
                        return error('Method not allowed', 405);
                    }

                    const body = await request.json().catch(() => ({}));
                    const { sessionId, command } = body as { sessionId?: string; command?: string };
                    if (!sessionId) {
                        return error('Missing sessionId', 400);
                    }
                    if (!command) {
                        return error('Missing command', 400);
                    }

                    const session = await getSession(sessionId);
                    if (!session) {
                        return error('Session not found', 404);
                    }

                    if (['completed', 'failed', 'cancelled'].includes(session.status)) {
                        return error(`Session is ${session.status}`, 400);
                    }

                    console.log(`[ComputerUseV2] Send command to session ${sessionId}: ${command}`);

                    // Take current screenshot
                    const { screenshot, url: currentUrl } = await takeScreenshot(session.browserbaseConnectUrl);

                    // Add new command with screenshot to conversation
                    session.conversationHistory.push({
                        role: 'user',
                        parts: [
                            { text: `Follow-up instruction: ${command}` },
                            {
                                inlineData: {
                                    mimeType: 'image/png',
                                    data: screenshot,
                                },
                            },
                        ],
                    });

                    session.goal = command;
                    session.status = 'in_progress';
                    session.currentUrl = currentUrl;
                    session.screenshotBase64 = screenshot;
                    await saveSession(session);

                    // Continue agent loop
                    runAgentLoop(session).catch(err => {
                        console.error(`[ComputerUseV2] Agent loop crashed:`, err);
                    });

                    return json({
                        sessionId,
                        status: 'in_progress',
                        message: 'Command sent',
                    });
                }

                default:
                    return error(`Unknown action: ${action}`, 400);
            }
        } catch (err) {
            console.error(`[ComputerUseV2] Handler error:`, err);
            return error(String(err), 500);
        }
    },
};
