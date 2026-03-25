import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as dotenv from 'dotenv';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import * as querystring from 'querystring';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as phoneAgentService from '../services/phoneAgentService';
import * as url from 'url';
import * as path from 'path';
import * as audioUtils from './audio-utils.js';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || '10000', 10);
const DOMAIN = process.env.RENDER_EXTERNAL_HOSTNAME || process.env.NGROK_URL;

if (!DOMAIN) {
    console.warn("Warning: Neither RENDER_EXTERNAL_HOSTNAME nor NGROK_URL is set. The server will use localhost (manual setup required).");
}

const WS_URL = DOMAIN ? `wss://${DOMAIN}/ws` : `ws://localhost:${PORT}/ws`;
const WS_URL_FOR_HEALTH = WS_URL;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://www.freshfront.co';
const WS_LIVE_URL = DOMAIN ? `wss://${DOMAIN}/ws-live` : `ws://localhost:${PORT}/ws-live`;

const WELCOME_GREETING = "Hi! I am a voice assistant powered by Twilio and Google Gemini. Ask me anything!";

const DEFAULT_SYSTEM_PROMPT = `You are a helpful and friendly voice assistant. This conversation is happening over a phone call, so your responses will be spoken aloud. 
Please adhere to the following rules:
1. Provide clear, concise, and direct answers.
2. Spell out all numbers (e.g., say 'one thousand two hundred' instead of 1200).
3. Do not use any special characters like asterisks, bullet points, or emojis.
4. Keep the conversation natural and engaging.`;

// ─── Voice Mapping ────────────────────────────────────────────────────────────
// The ProfileSettingsPage exposes Gemini voice names (e.g. 'Kore', 'Fenrir').
// Twilio ConversationRelay with ttsProvider='Google' supports Chirp3 HD voices
// in the format 'en-US-Chirp3-HD-{VoiceName}'.
// Fallback Journey voices are used if no voiceName is configured.
const GEMINI_FEMALE_VOICES = new Set([
    'Achernar', 'Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome',
    'Gacrux', 'Kore', 'Laomedeia', 'Leda', 'Pulcherrima', 'Sulafat',
    'Vindemiatrix', 'Zephyr'
]);
const GEMINI_MALE_VOICES = new Set([
    'Achird', 'Algenib', 'Alnilam', 'Charon', 'Enceladus', 'Fenrir',
    'Iapetus', 'Orus', 'Puck', 'Rasalgethi', 'Sadachbia', 'Sadaltager',
    'Schedar', 'Umbriel', 'Zubenelgenubi'
]);

function resolveVoice(config: any): string {
    const voiceName = config?.voiceName || '';
    const voiceGender = config?.voiceGender || 'female';
    // If voiceName is a known Gemini voice, use Chirp3 HD format
    if (voiceName && (GEMINI_FEMALE_VOICES.has(voiceName) || GEMINI_MALE_VOICES.has(voiceName))) {
        return `en-US-Chirp3-HD-${voiceName}`;
    }
    // Fallback: use Google Journey voices based on gender
    return voiceGender === 'male' ? 'en-US-Journey-D' : 'en-US-Journey-F';
}

// Escape special characters for use inside XML attributes
function escapeXmlAttr(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const GOOGLE_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
    console.error("Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable is not set.");
    process.exit(1);
}

// ─── Firebase Admin (lazy / non-blocking init) ────────────────────────────────
// IMPORTANT: We do NOT call initFirebase() during module load.
// The HTTP server must start listening FIRST so Twilio's 15s window is met.
let db: ReturnType<typeof getFirestore> | null = null;
let dbInitialized = false;

function initFirebase(): ReturnType<typeof getFirestore> | null {
    if (dbInitialized) return db;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
        console.error("[Firebase] Missing environment variables. Running without Firestore.");
        dbInitialized = true;
        return null;
    }
    try {
        if (!getApps().length) {
            initializeApp({ credential: cert({ projectId, clientEmail, privateKey } as any) });
        }
        db = getFirestore();
        console.log("[Firebase] Admin initialized successfully.");
    } catch (error) {
        console.error("[Firebase] Initialization failed:", error);
    }
    dbInitialized = true;
    return db;
}

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// Define tools for Gemini
const leadCaptureTool = {
    functionDeclarations: [
        {
            name: "saveCapturedLead",
            description: "Saves information collected from the user during the call as a lead.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    data: {
                        type: Type.OBJECT,
                        description: "Key-value pairs of collected information (e.g. { 'Name': 'John', 'Email': 'john@example.com' })",
                        additionalProperties: { type: Type.STRING } as Schema
                    }
                },
                required: ["data"]
            }
        },
        {
            name: "transferToHuman",
            description: "Transfers the call to a real human. Only use this if the caller explicitly asks to speak to a human and you have confirmed you collected their information.",
            parameters: {
                type: Type.OBJECT,
                properties: {}
            }
        },
        {
            name: "bookAppointment",
            description: "Books an appointment on the owner's Google Calendar. Use this ONLY if appointment booking is enabled. Confirm the date and time with the caller first. Pass along all lead details in the notes.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    dateTimeIso: {
                        type: Type.STRING,
                        description: "Start time as an ISO 8601 string, e.g. '2026-03-25T14:00:00'. Use the caller's local date/time as best you can infer."
                    },
                    durationMinutes: {
                        type: Type.NUMBER,
                        description: "Duration of the appointment in minutes (default 60)."
                    },
                    notes: {
                        type: Type.STRING,
                        description: "All collected lead details formatted as a summary (e.g. 'Name: John, Phone: 555-1234, Inquiry: Roofing quote')."
                    }
                },
                required: ["dateTimeIso", "notes"]
            }
        }
    ]
};

const voiceSetupTools = {
    functionDeclarations: [
        {
            name: "deleteAgent",
            description: "Deletes an existing phone agent number and releases it back to Twilio. Use this if the user wants to remove an agent or replace their number.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    phoneNumber: {
                        type: Type.STRING,
                        description: "The E.164 phone number to delete (e.g. '+16474904049')."
                    }
                },
                required: ["phoneNumber"]
            }
        },
        {
            name: "searchAreaCodes",
            description: "Looks up available area codes in a specific geographic state or province (e.g. 'ON' for Ontario, 'NY' for New York). Call this BEFORE provisioning the agent to give the user a choice of area codes.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    region: { type: Type.STRING, description: "State or province abbreviation (e.g., 'ON', 'NY', 'CA', 'TX')" }
                },
                required: ["region"]
            }
        },
        {
            name: "provisionAgent",
            description: "Reserves a new phone number and configures it based on the gathered details.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    agentType: { type: Type.STRING, description: "Must be 'leads' or 'hotline'" },
                    label: { type: Type.STRING, description: "Friendly name for the hotline (hotline path)" },
                    areaCode: { type: Type.STRING, description: "The 3-digit area code chosen by the user" },
                    companyName: { type: Type.STRING, description: "Name of the business (leads path)" },
                    description: { type: Type.STRING, description: "Short business description (leads path)" },
                    website: { type: Type.STRING, description: "Business website (leads path)" },
                    email: { type: Type.STRING, description: "Business email (leads path)" },
                    productService: { type: Type.STRING, description: "Product or service offered (leads path)" },
                    dataToCollect: { 
                        type: Type.ARRAY, 
                        items: { type: Type.STRING },
                        description: "List of fields to collect from callers e.g. ['Name', 'Phone Number'] (leads path)"
                    },
                    leadDestination: { type: Type.STRING, description: "Route for leads: 'email', 'sms', or 'app' (leads path)" },
                    humanHandoffEnabled: { type: Type.BOOLEAN, description: "Whether human handoff is enabled (leads path, optional)" },
                    humanHandoffNumber: { type: Type.STRING, description: "The phone number to forward calls to (leads path, required if handoff enabled)" },
                    followUpSms: { type: Type.STRING, description: "Automated SMS to send to callers after they hang up (leads path, e.g. 'Thanks for calling! Book here: [link]')" }
                },
                required: ["agentType"]
            }
        },
        {
            name: "getAgentAnalytics",
            description: "Queries the user's phone agent leads or conversation history to provide summaries and trends. Use this when the user asks for stats, lead counts, or common questions.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    type: { 
                        type: Type.STRING, 
                        description: "The type of analytics to fetch: 'leads' for lead counts/info, 'conversations' for trends in what callers are asking." 
                    },
                    timeRange: { 
                        type: Type.STRING, 
                        description: "The time period to analyze: 'today', 'week', or 'month' (default: 'week')."
                    }
                },
                required: ["type"]
            }
        }
    ]
};

// Project management tools for linked account callers
const projectManagementTools = {
    functionDeclarations: [
        {
            name: "listProjects",
            description: "Returns the names and IDs of the user's projects so the user can choose one.",
            parameters: { type: Type.OBJECT, properties: {} }
        },
        {
            name: "createProject",
            description: "Creates a brand new project with a name and optional description.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Project name" },
                    description: { type: Type.STRING, description: "Short project description" }
                },
                required: ["name"]
            }
        },
        {
            name: "addNote",
            description: "Adds a note to an existing project.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    projectId: { type: Type.STRING, description: "The project ID" },
                    title: { type: Type.STRING, description: "Short title for the note" },
                    content: { type: Type.STRING, description: "Full content of the note" }
                },
                required: ["projectId", "title", "content"]
            }
        },
        {
            name: "addTask",
            description: "Adds a task to an existing project.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    projectId: { type: Type.STRING, description: "The project ID" },
                    title: { type: Type.STRING, description: "Task title" },
                    description: { type: Type.STRING, description: "Optional task description" },
                    priority: { type: Type.STRING, description: "Priority: low, medium, or high" }
                },
                required: ["projectId", "title", "priority"]
            }
        },
        {
            name: "addCalendarEvent",
            description: "Adds a calendar event to an existing project.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    projectId: { type: Type.STRING, description: "The project ID" },
                    title: { type: Type.STRING, description: "Event title" },
                    date: { type: Type.STRING, description: "Event date as ISO string or natural language like 'next Friday'" },
                    description: { type: Type.STRING, description: "Optional event description" }
                },
                required: ["projectId", "title", "date"]
            }
        },
        {
            name: "generateImage",
            description: "Generates an AI image for a project and saves it.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    projectId: { type: Type.STRING, description: "The project ID" },
                    prompt: { type: Type.STRING, description: "Detailed image description" }
                },
                required: ["projectId", "prompt"]
            }
        }
    ]
};

// Store active chat sessions
const sessions: { [callSid: string]: { contents: any[], uid?: string, toNumber?: string, agentName?: string, agentInstructions?: string, systemPrompt?: string } } = {};

// Helper to normalize phone numbers (E.164 conversion)
function normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    // If already potentially E.164 (starts with +), just strip non-digits except +
    if (phone.trim().startsWith('+')) {
        return '+' + phone.replace(/\D/g, '');
    }
    const digits = phone.replace(/\D/g, '');
    if (!digits) return '';
    // 10 digits -> assume US/Canada
    if (digits.length === 10) return `+1${digits}`;
    // 11 digits starting with 1 -> assume US/Canada
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    // Fallback: just prepend +
    return `+${digits}`;
}

// Helper to find user config by phone number — with a 3s timeout so TwiML is always returned quickly
async function getUserConfig(phoneNumber: string): Promise<any> {
    if (!phoneNumber) return null;
    const firestore = initFirebase();
    if (!firestore) return null;

    const normalizedTarget = normalizePhoneNumber(phoneNumber);
    const noPlusTarget = normalizedTarget.startsWith('+') ? normalizedTarget.substring(1) : normalizedTarget;

    // Race against a 3-second timeout so TwiML is always returned within Twilio's 15s window
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => {
        console.warn(`[Config] Lookup timed out for ${phoneNumber}. Proceeding with defaults.`);
        resolve(null);
    }, 3000));

    const lookupPromise = (async () => {
        try {
            const usersRef = firestore.collection('users');
            const searchValues = [phoneNumber, normalizedTarget, noPlusTarget, `+${noPlusTarget}`];
            const uniqueValues = [...new Set(searchValues)].slice(0, 10);
            let snapshot = await usersRef.where('agentPhoneNumbersList', 'array-contains-any', uniqueValues).limit(1).get();

            if (snapshot.empty) {
                snapshot = await usersRef.where('agentPhoneNumber', 'in', uniqueValues).limit(1).get();
            }

            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                return { uid: doc.id, ...doc.data() };
            }
            console.warn(`[Config] No user found for ${phoneNumber}.`);
            return null;
        } catch (err) {
            console.error("[Config] Firestore Lookup Error:", err);
            return null;
        }
    })();

    return Promise.race([lookupPromise, timeoutPromise]);
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

// Helper: send an SMS via Twilio REST API
async function sendSms(to: string, from: string, body: string): Promise<void> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) { console.warn('[SMS] Missing Twilio credentials'); return; }
    const authStr = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const params = new URLSearchParams();
    params.append('From', from);
    params.append('Body', body);
    try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        if (!res.ok) console.error('[SMS] Failed:', await res.text());
        else console.log(`[SMS] Sent to ${to}`);
    } catch (e) { console.error('[SMS] Error:', e); }
}

const server = http.createServer(async (req, res) => {
    // Safely parse URL to ignore query strings added by Twilio
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname;
    // Remove trailing slash if present (except for root)
    if (pathname !== '/' && pathname.endsWith('/')) {
        pathname = pathname.substring(0, pathname.length - 1);
    }

    // Health check endpoint — allows Render/UptimeRobot to keep the server awake
    if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/health' || pathname === '/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.method === 'GET') {
            res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), wsUrl: WS_URL_FOR_HEALTH }));
        } else {
            res.end(); // HEAD requests should not have a body
        }
        return;
    }

    // GET /twiml — for health probe / browser test
    if (req.method === 'GET' && pathname === '/twiml') {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Voice server is running.</Say></Response>`);
        return;
    }

    // POST /twiml-handoff — Handles ConversationRelay handoff
    if (req.method === 'POST' && pathname === '/twiml-handoff') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const postData = querystring.parse(body);
            const to = postData.To as string || '';
            let handoffNumber = '';
            
            try {
                const userData = await getUserConfig(to);
                const normalizedTarget = normalizePhoneNumber(to);
                const activeConfig = userData?.agentPhoneConfigs?.[to] || userData?.agentPhoneConfigs?.[normalizedTarget] || userData?.agentPhoneConfig;
                
                if (activeConfig?.humanHandoffEnabled && activeConfig?.humanHandoffNumber) {
                    handoffNumber = activeConfig.humanHandoffNumber;
                }
            } catch (e) {
                console.error('[TwiML-Handoff] Error looking up human handoff number:', e);
            }

            if (handoffNumber) {
                const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Transferring you now.</Say>
    <Dial>${escapeXmlAttr(handoffNumber)}</Dial>
</Response>`;
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                res.end(xmlResponse);
            } else {
                const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Sorry, human transfer is not available at this time.</Say>
</Response>`;
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                res.end(xmlResponse);
            }
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/twiml') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const startTime = Date.now();
            const postData = querystring.parse(body);
            const to = postData.To as string || '';
            const from = postData.From as string || '';

            console.log(`[TwiML] Incoming call to ${to} from ${from}`);

            // Setup Mode Trigger (Strictly for setup agents per user request)
            // Checked FIRST to avoid any expensive Firestore lookups or initializations
            if (to === '+16474904049') {
                const targetUrl = DOMAIN ? `https://${DOMAIN}/twiml-setup` : `http://localhost:${PORT}/twiml-setup`;
                const xmlRedirect = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Redirect method="POST">${targetUrl}</Redirect>
</Response>`;
                console.log(`[TwiML] Setup number detected. Redirecting instantly to ${targetUrl}.`);
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                res.end(xmlRedirect);
                return;
            }

            let welcomeGreeting = WELCOME_GREETING;
            let voice = 'en-US-Journey-F';
            const ttsProvider = 'Google';
            let isNoteMode = false;

            try {
                // This call has a 3s race condition built-in
                const userData = await getUserConfig(to);
                const normalizedTarget = normalizePhoneNumber(to);
                const activeConfig = userData?.agentPhoneConfigs?.[to] || userData?.agentPhoneConfigs?.[normalizedTarget] || userData?.agentPhoneConfig;
                
                if (activeConfig?.enabled) {
                    isNoteMode = activeConfig.mode === 'notes' || activeConfig.mode === 'note';
                    welcomeGreeting = activeConfig.systemPrompt 
                        ? (activeConfig.welcomeGreeting || "Hi, I'm your AI assistant. How can I help you today?")
                        : welcomeGreeting;

                    // Resolve voice using voiceName (Gemini Chirp3 HD) or voiceGender fallback
                    voice = resolveVoice(activeConfig);
                    console.log(`[TwiML] Resolved voice: ${voice} (mode=${activeConfig.mode}, voiceName=${activeConfig.voiceName})`);
                }
            } catch (e) {
                console.error('[TwiML] Error fetching user config:', e);
            }

            console.log(`[TwiML] Responding in ${Date.now() - startTime}ms (noteMode=${isNoteMode})`);

            // Note Mode: redirect to dedicated note handler
            if (isNoteMode) {
                const noteTwimlUrl = DOMAIN ? `https://${DOMAIN}/twiml-note` : `http://localhost:${PORT}/twiml-note`;
                const xmlRedirect = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Redirect method="POST">${noteTwimlUrl}</Redirect>
</Response>`;
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                res.end(xmlRedirect);
                return;
            }

            // Route to Gemini Live API bridge (raw audio stream, lowest latency)
            const liveHandlerUrl = DOMAIN ? `https://${DOMAIN}/twiml-live` : `http://localhost:${PORT}/twiml-live`;
            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Redirect method="POST">${liveHandlerUrl}?to=${encodeURIComponent(to)}&amp;from=${encodeURIComponent(from)}&amp;voice=${encodeURIComponent(voice)}&amp;greeting=${encodeURIComponent(welcomeGreeting)}&amp;agentMode=leads</Redirect>
</Response>`;
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(xmlResponse);
        });
        return;
    }

    // GET /twiml-live — health probe
    if (req.method === 'GET' && pathname === '/twiml-live') {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Gemini Live voice server is running.</Say></Response>`);
        return;
    }

    // POST /twiml-live — Issues a <Connect><Stream> to bridge raw audio to Gemini Live
    if (req.method === 'POST' && pathname === '/twiml-live') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            const postData = querystring.parse(body);
            // Accept params from both query string (when redirected from /twiml) and POST body
            const parsedUrl2 = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const to2 = parsedUrl2.searchParams.get('to') || postData.To as string || '';
            const from2 = parsedUrl2.searchParams.get('from') || postData.From as string || '';
            const voice2 = parsedUrl2.searchParams.get('voice') || 'en-US-Chirp3-HD-Kore';
            const greeting2 = parsedUrl2.searchParams.get('greeting') || 'Hello! How can I help you today?';
            const agentMode = parsedUrl2.searchParams.get('agentMode') || postData.agentMode as string || 'leads';
            const WS_LIVE_URL = DOMAIN ? `wss://${DOMAIN}/ws-live` : `ws://localhost:${PORT}/ws-live`;

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${WS_LIVE_URL}">
            <Parameter name="to" value="${escapeXmlAttr(to2)}" />
            <Parameter name="from" value="${escapeXmlAttr(from2)}" />
            <Parameter name="voice" value="${escapeXmlAttr(voice2)}" />
            <Parameter name="greeting" value="${escapeXmlAttr(greeting2)}" />
            <Parameter name="agentMode" value="${escapeXmlAttr(agentMode)}" />
        </Stream>
    </Connect>
</Response>`;
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(xmlResponse);
        });
        return;
    }

    // GET /twiml-note — probe endpoint
    if (req.method === 'GET' && pathname === '/twiml-note') {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Note Mode voice server is running.</Say></Response>`);
        return;
    }

    // POST /twiml-note — Note Mode voice handler
    if (req.method === 'POST' && pathname === '/twiml-note') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const postData = querystring.parse(body);
            const to = postData.To as string || '';
            const from = postData.From as string || '';

            let welcomeGreeting = 'Hello! How can I help with your notes today?';
            let voice = 'en-US-Journey-F';

            try {
                const userData = await getUserConfig(to);
                const normalizedTarget = normalizePhoneNumber(to);
                const activeConfig = userData?.agentPhoneConfigs?.[to] || userData?.agentPhoneConfigs?.[normalizedTarget] || userData?.agentPhoneConfig;
                if (activeConfig?.enabled) {
                    voice = resolveVoice(activeConfig);
                    welcomeGreeting = activeConfig.welcomeGreeting || welcomeGreeting;
                }
            } catch (e) {
                console.error('[TwiML-Note] Error:', e);
            }

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${WS_LIVE_URL}">
            <Parameter name="to" value="${escapeXmlAttr(to)}" />
            <Parameter name="from" value="${escapeXmlAttr(from)}" />
            <Parameter name="agentMode" value="note" />
            <Parameter name="voice" value="${voice}" />
            <Parameter name="greeting" value="${escapeXmlAttr(welcomeGreeting)}" />
        </Stream>
    </Connect>
</Response>`;
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(xmlResponse);
        });
        return;
    }

    // GET /twiml-setup — probe endpoint
    if (req.method === 'GET' && pathname === '/twiml-setup') {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Setup Mode voice server is running.</Say></Response>`);
        return;
    }

    // POST /twiml-setup — Setup Mode voice handler
    if (req.method === 'POST' && pathname === '/twiml-setup') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const postData = querystring.parse(body);
            const to = postData.To as string || '';
            const from = postData.From as string || '';
            const callerCity = postData.CallerCity as string || '';
            const callerState = postData.CallerState as string || '';
            const callerCountry = postData.CallerCountry as string || '';
            
            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${WS_LIVE_URL}">
            <Parameter name="to" value="${escapeXmlAttr(to)}" />
            <Parameter name="from" value="${escapeXmlAttr(from)}" />
            <Parameter name="agentMode" value="setup" />
            <Parameter name="callerCity" value="${escapeXmlAttr(callerCity)}" />
            <Parameter name="callerState" value="${escapeXmlAttr(callerState)}" />
            <Parameter name="callerCountry" value="${escapeXmlAttr(callerCountry)}" />
            <Parameter name="greeting" value="Hi! Welcome to the Freshfront agent setup assistant. Which type of phone agent would you like to create today?" />
        </Stream>
    </Connect>
</Response>`;
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(xmlResponse);
        });
        return;
    }

    // GET /twiml-projects — health probe
    if (req.method === 'GET' && pathname === '/twiml-projects') {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Projects mode is running.</Say></Response>`);
        return;
    }

    // POST /twiml-projects — Project Management voice handler for linked callers
    if (req.method === 'POST' && pathname === '/twiml-projects') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const postData = querystring.parse(body);
            const to = postData.To as string || '';
            const from = postData.From as string || '';

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${WS_LIVE_URL}">
            <Parameter name="to" value="${escapeXmlAttr(to)}" />
            <Parameter name="from" value="${escapeXmlAttr(from)}" />
            <Parameter name="agentMode" value="projects" />
            <Parameter name="greeting" value="Hi! I'm calling for your project assistant. How can I help you manage your projects today?" />
        </Stream>
    </Connect>
</Response>`;
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(xmlResponse);
        });
        return;
    }

    if (true) {
        console.warn(`[HTTP] 404 Not Found: ${req.method} ${req.url}`);
        res.writeHead(404);
        res.end('Not Found');
    }
});


// GET /twiml-projects — health probe
// POST /twiml-projects — handled inside createServer above.
// (These routes are injected into the existing server handler. The standalone function below is a placeholder.)


// ─── WebSocket Server ─────────────────────────────────────────────────────────
// Unified Gemini Multimodal Live API Bridge
const wssLive = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const { pathname } = url.parse(request.url || '');
    if (pathname === '/ws-live') {
        wssLive.handleUpgrade(request, socket, head, (ws) => {
            wssLive.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});


// ─── Legacy Handler Cleaned ───


// ─── Legacy Note Handler Cleaned ───


// ─── Legacy Setup Handler Cleaned ───


// ─── Legacy Projects Handler Cleaned ───



// ─── Legacy Media Handler Cleaned ───


// ─── Gemini Live API Bridge WebSocket (/ws-live) ──────────────────────────────
// Bridges Twilio raw Media Streams (8kHz mulaw) ↔ Gemini Live API (16kHz/24kHz PCM).
// This replaces ConversationRelay for the main leads agent, providing native VAD,
// interruption handling, and sub-500ms response latency.
wssLive.on('connection', (wsTwilio: WebSocket) => {
    let streamSid: string | null = null;
    let callSid: string | null = null;
    let callerNumber: string = '';
    let toNumber: string = '';
    let geminiSession: any = null;
    let uid: string = '';
    let systemPrompt: string = DEFAULT_SYSTEM_PROMPT;
    let agentConfig: any = null;
    const messageQueue: any[] = [];
    let sessionReady = false;

    console.log('[WS-Live] Twilio connected (Gemini Live bridge)');

    // Helper: flush queued Gemini messages when session is ready
    async function processQueue() {
        while (messageQueue.length > 0 && geminiSession) {
            const msg = messageQueue.shift();
            try { geminiSession.sendRealtimeInput(msg); } catch (_) {}
        }
    }

    wsTwilio.on('message', async (rawMessage: Buffer | string) => {
        try {
            const data = JSON.parse(rawMessage.toString());

            // ── 1. Stream Start ──────────────────────────────────────────────
            if (data.event === 'start') {
                streamSid = data.start.streamSid;
                callSid = data.start.callSid;
                const customParams = data.start.customParameters || {};
                const agentMode = customParams.agentMode || 'leads';
                const callerCity = customParams.callerCity || '';
                const callerState = customParams.callerState || '';
                const callerCountry = customParams.callerCountry || '';
                const greeting = customParams.greeting || WELCOME_GREETING;
                const configuredVoice = customParams.voice || 'en-US-Chirp3-HD-Kore';

                console.log(`[WS-Live] Stream started: ${streamSid} (call: ${callSid}, mode: ${agentMode})`);

                // Create a mode-specific initialization context
                try {
                    const params = new URLSearchParams(wsTwilio.url?.split('?')[1] || '');
                    toNumber = customParams.to || params.get('to') || '';
                    callerNumber = customParams.from || params.get('from') || '';

                    const userData = await getUserConfig(toNumber);
                    const normalizedTo = normalizePhoneNumber(toNumber);
                    agentConfig = userData?.agentPhoneConfigs?.[toNumber]
                        || userData?.agentPhoneConfigs?.[normalizedTo]
                        || userData?.agentPhoneConfig;
                    uid = userData?.uid || '';
                    const firestore = initFirebase();

                    if (agentMode === 'note') {
                        // ── Note Mode Initialization ──
                        let notesContext = 'The user has not sent any notes yet.';
                        let notesCount = 0;
                        if (firestore && uid) {
                            const notesSnap = await firestore.collection('users').doc(uid).collection('phoneAgentNotes').orderBy('timestamp', 'desc').limit(200).get();
                            notesCount = notesSnap.size;
                            if (!notesSnap.empty) {
                                notesContext = notesSnap.docs.map(d => `[${new Date(d.data().timestamp).toLocaleString()}] ${d.data().body}`).join('\n');
                            }
                        }
                        systemPrompt = `You are a personal voice assistant with access to the user's notes. These notes were sent as SMS text messages to this number.
You MUST answer questions based on the content of these notes.
This is a live phone call, so be concise and speak naturally. Do not use markdown, bullet points, asterisks, or emojis.
${agentConfig?.systemPrompt ? `\n\nAdditional instructions: ${agentConfig.systemPrompt}` : ''}
\n\n--- USER'S NOTES (${notesCount} total) ---\n${notesContext}\n--- END OF NOTES ---`;

                    } else if (agentMode === 'setup') {
                        // ── Setup Mode Initialization ──
                        systemPrompt = `You are a Freshfront voice setup assistant. You help callers create and configure their own AI phone agents.
Your goal is to guide them through choosing an agent type (Leads, Projects, or Notes) and configuring it.
You are on a phone call. Be friendly, concise, and helpful.
Caller Location: ${callerCity}, ${callerState}, ${callerCountry}
Available Tools: Use searchAreaCodes to help them find a phone number for their new agent.
${DEFAULT_SYSTEM_PROMPT}`;

                    } else if (agentMode === 'projects') {
                        // ── Projects Mode Initialization ──
                        let projectListContext = 'You have no projects yet.';
                        let projectsCache: any[] = [];
                        if (firestore && uid) {
                            const projectsSnap = await firestore.collection('users').doc(uid).collection('projects').orderBy('lastModified', 'desc').limit(15).get();
                            projectsCache = projectsSnap.docs.map(d => ({ id: d.id, name: d.data().name || 'Untitled' }));
                            projectListContext = projectsCache.length > 0 ? projectsCache.map((p, i) => `${i + 1}. "${p.name}" (ID: ${p.id})`).join('\n') : 'You have no projects yet.';
                        }
                        const callerName = userData?.displayName || userData?.firstName || 'there';
                        systemPrompt = `You are a Freshfront voice project assistant. The user's name is ${callerName}.
You help them manage their projects hands-free. Be concise and natural.
Never use markdown. Refer to projects by name only (no IDs).
CURRENT DATE: ${new Date().toDateString()}
USER'S PROJECTS:
${projectListContext}
CAPABILITIES: Create projects, add notes/tasks/events, generate images, list projects.
${agentConfig?.systemPrompt ? `\n\nUser's custom instructions: ${agentConfig.systemPrompt}` : ''}`;

                    } else {
                        // ── Leads Mode (Default) ──
                        if (agentConfig?.enabled) {
                            let customInstructions = agentConfig.systemPrompt || '';
                            if ((agentConfig.mode === 'leads' || agentConfig.leadCaptureEnabled) && agentConfig.leadFields?.length > 0) {
                                const fields = agentConfig.leadFields.map((f: any) => `${f.name}${f.required ? ' (required)' : ''}`).join(', ');
                                customInstructions += `\n\nLEAD CAPTURE TASK: Your primary goal is to politely collect the following information: ${fields}. Call 'saveCapturedLead' when done.`;
                                if (agentConfig.appointmentBookingEnabled) {
                                    customInstructions += `\n\nAPPOINTMENT BOOKING: After collecting info, offer to book an appointment. Call 'bookAppointment' when needed.`;
                                }
                            }
                            systemPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\nUSER'S AGENT INSTRUCTIONS: ${customInstructions}`;
                        }
                    }
                } catch (configErr) {
                    console.error('[WS-Live] Error loading user config:', configErr);
                }

                // Resolve Gemini voice name
                let voiceName = configuredVoice;
                if (voiceName.startsWith('en-US-Chirp3-HD-')) { voiceName = voiceName.replace('en-US-Chirp3-HD-', ''); }
                if (voiceName.startsWith('en-US-Journey')) { voiceName = 'Kore'; } // Map stable voices to preview voices if needed

                // Assign tools based on mode
                let activeTools: any[] = [];
                if (agentMode === 'setup') { activeTools = [voiceSetupTools]; }
                else if (agentMode === 'projects') { activeTools = [projectManagementTools]; }
                else if (agentMode === 'leads' || (agentConfig?.mode === 'leads' || !!agentConfig?.leadCaptureEnabled)) {
                    activeTools = [leadCaptureTool];
                }

                // Open Gemini Live session
                try {
                    const liveConfig = {
                        responseModalities: ['AUDIO'],
                        systemInstruction: systemPrompt,
                        speechConfig: {
                            voiceConfig: { prebuiltVoiceConfig: { voiceName } }
                        },
                        tools: activeTools,
                        inputAudioTranscription: {},   // log what caller says
                        outputAudioTranscription: {},  // log what agent says
                    };

                    geminiSession = await (ai as any).live.connect({
                        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                        config: liveConfig,
                        callbacks: {
                            onopen: () => {
                                console.log(`[WS-Live] Gemini session open for call ${callSid}`);
                                sessionReady = true;
                                processQueue();
                                // Kick off the greeting via text so Gemini speaks it
                                geminiSession.sendClientContent({
                                    turns: [{ role: 'user', parts: [{ text: `Please greet the caller now. Use this greeting: "${greeting}"` }] }],
                                    turnComplete: true
                                });
                            },
                            async onmessage(msg: any) {
                                // ── Audio response → send to Twilio ──────────
                                const parts = msg?.serverContent?.modelTurn?.parts || [];
                                for (const part of parts) {
                                    if (part?.inlineData?.data && !streamSid) continue;
                                    if (part?.inlineData?.data) {
                                        try {
                                            const pcm24 = new Int16Array(Buffer.from(part.inlineData.data, 'base64').buffer);
                                            const pcm8 = audioUtils.resample24To8(pcm24);
                                            const mulaw = audioUtils.pcmToMulaw(pcm8);
                                            wsTwilio.send(JSON.stringify({
                                                event: 'media',
                                                streamSid,
                                                media: { payload: Buffer.from(mulaw).toString('base64') }
                                            }));
                                        } catch (audioErr) {
                                            console.error('[WS-Live] Audio conversion error:', audioErr);
                                        }
                                    }
                                }

                                // ── Transcription logging ─────────────────────
                                if (msg?.serverContent?.inputTranscription?.text) {
                                    console.log(`[WS-Live] Caller said: ${msg.serverContent.inputTranscription.text}`);
                                }
                                if (msg?.serverContent?.outputTranscription?.text) {
                                    console.log(`[WS-Live] Agent said: ${msg.serverContent.outputTranscription.text}`);
                                }

                                // ── Interruption → clear Twilio audio buffer ──
                                if (msg?.serverContent?.interrupted && streamSid) {
                                    wsTwilio.send(JSON.stringify({ event: 'clear', streamSid }));
                                    console.log(`[WS-Live] Interruption detected — cleared Twilio buffer`);
                                }

                                // ── Tool calls ────────────────────────────────
                                if (msg?.toolCall?.functionCalls) {
                                    const toolResponses: any[] = [];
                                    for (const call of msg.toolCall.functionCalls) {
                                        console.log(`[WS-Live] Tool call: ${call.name}`, call.args);
                                        let result: any = { success: false };

                                        if (call.name === 'saveCapturedLead') {
                                            const firestore = initFirebase();
                                            if (uid && firestore) {
                                                try {
                                                    await firestore.collection('users').doc(uid).collection('phoneAgentLeads').add({
                                                        callerNumber,
                                                        data: (call.args as any).data,
                                                        timestamp: Date.now()
                                                    });
                                                    result = { success: true };
                                                } catch (fsErr) {
                                                    console.error('[WS-Live] Error saving lead:', fsErr);
                                                }
                                            }
                                        } else if (call.name === 'transferToHuman') {
                                            result = { success: true };
                                            setTimeout(() => {
                                                if (geminiSession) geminiSession.close();
                                                wsTwilio.close();
                                            }, 1500);
                                        } else if (call.name === 'bookAppointment') {
                                            const apptArgs = call.args as any;
                                            try {
                                                const agentUserData = await getUserConfig(toNumber);
                                                const normalizedTo2 = normalizePhoneNumber(toNumber);
                                                const agentCfg = agentUserData?.agentPhoneConfigs?.[toNumber] || agentUserData?.agentPhoneConfigs?.[normalizedTo2] || agentUserData?.agentPhoneConfig;
                                                if (agentCfg?.appointmentBookingEnabled && agentUserData?.uid) {
                                                    const firestore3 = initFirebase();
                                                    if (firestore3) {
                                                        const calTokenSnap = await firestore3.doc(`users/${agentUserData.uid}/integrations/googleCalendar`).get();
                                                        const refreshToken = calTokenSnap?.data()?.refreshToken;
                                                        if (refreshToken) {
                                                            const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || '';
                                                            const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || '';
                                                            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                                                body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
                                                            });
                                                            if (tokenRes.ok) {
                                                                const tokenJson: any = await tokenRes.json();
                                                                const startMs = new Date(apptArgs.dateTimeIso).getTime();
                                                                const endMs = startMs + (apptArgs.durationMinutes || 60) * 60 * 1000;
                                                                const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
                                                                    method: 'POST',
                                                                    headers: { Authorization: `Bearer ${tokenJson.access_token}`, 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({
                                                                        summary: `📞 Appointment – ${callerNumber}`,
                                                                        description: `Booked via phone agent.\n\n${apptArgs.notes}`,
                                                                        start: { dateTime: new Date(startMs).toISOString() },
                                                                        end: { dateTime: new Date(endMs).toISOString() },
                                                                    }),
                                                                });
                                                                if (calRes.ok) result = { success: true, eventId: (await calRes.json()).id };
                                                            }
                                                        }
                                                    }
                                                }
                                            } catch (bookErr) {
                                                console.error('[WS-Live] bookAppointment error:', bookErr);
                                            }
                                        } else if (call.name === 'searchAreaCodes') {
                                            const { region } = call.args as any;
                                            try {
                                                const res = await phoneAgentService.searchAvailableAreaCodes(region);
                                                result = { success: true, areaCodes: res.availableAreaCodes, message: `Found numbers in area codes: ${res.availableAreaCodes.join(', ')}` };
                                            } catch (err: any) {
                                                result = { success: false, error: err.message };
                                            }
                                        } else if (call.name === 'provisionAgent') {
                                            try {
                                                const res = await phoneAgentService.provisionNewAgent({ ...call.args as any, callerNumber });
                                                result = res;
                                            } catch (err: any) {
                                                result = { success: false, error: err.message };
                                            }
                                        } else if (call.name === 'deleteAgent') {
                                            const { phoneNumber } = call.args as any;
                                            const targetNumber = normalizePhoneNumber(phoneNumber);
                                            try {
                                                const released = await phoneAgentService.releaseTwilioNumber(targetNumber);
                                                if (released) {
                                                    const firestore = initFirebase();
                                                    if (firestore && uid) {
                                                        const userData = await getUserConfig(toNumber);
                                                        if (userData) {
                                                            const newList = userData.agentPhoneNumbersList.filter((n: string) => n !== targetNumber);
                                                            const newConfigs = { ...userData.agentPhoneConfigs };
                                                            delete newConfigs[targetNumber];
                                                            await firestore.collection('users').doc(uid).update({ agentPhoneNumbersList: newList, agentPhoneConfigs: newConfigs });
                                                        }
                                                    }
                                                    result = { success: true };
                                                } else {
                                                    result = { success: false, error: "Failed to release number via Twilio." };
                                                }
                                            } catch (err: any) {
                                                result = { success: false, error: err.message };
                                            }
                                        } else if (call.name === 'getAgentAnalytics') {
                                            const { timeRange, type } = call.args as any;
                                            const firestore = initFirebase();
                                            if (firestore && uid) {
                                                try {
                                                    const now = new Date();
                                                    let startTime = new Date();
                                                    if (timeRange === 'today') startTime.setHours(0, 0, 0, 0);
                                                    else if (timeRange === 'week') startTime.setDate(now.getDate() - 7);
                                                    else if (timeRange === 'month') startTime.setDate(now.getDate() - 30);
                                                    const startTs = startTime.getTime();
                                                    if (type === 'leads') {
                                                        const snapshot = await firestore.collection('users').doc(uid).collection('phoneAgentLeads').where('timestamp', '>=', startTs).get();
                                                        result = { success: true, count: snapshot.size, summary: `You received ${snapshot.size} leads.` };
                                                    } else {
                                                        result = { success: true, info: "General analytics retrieval not fully expanded in bridge yet." };
                                                    }
                                                } catch (err: any) {
                                                    result = { success: false, error: err.message };
                                                }
                                            }
                                        } else if (call.name === 'listProjects') {
                                            const firestore = initFirebase();
                                            if (uid && firestore) {
                                                const snap = await firestore.collection('users').doc(uid).collection('projects').orderBy('lastModified', 'desc').limit(15).get();
                                                const projects = snap.docs.map(d => d.data().name || 'Untitled');
                                                result = { success: true, projects, summary: projects.join(', ') };
                                            }
                                        } else if (call.name === 'createProject') {
                                            const { name, description } = call.args as any;
                                            const firestore = initFirebase();
                                            if (uid && firestore) {
                                                const now = Date.now();
                                                const newId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
                                                await firestore.collection('users').doc(uid).collection('projects').doc(newId).set({ id: newId, name, description: description || '', ownerUid: uid, createdAt: now, lastModified: now });
                                                result = { success: true, projectId: newId, name };
                                            }
                                        } else if (call.name === 'addNote' || call.name === 'addTask' || call.name === 'addCalendarEvent') {
                                            const firestore = initFirebase();
                                            if (uid && firestore) {
                                                const { projectId, title, content, description, priority, date } = call.args as any;
                                                const coll = call.name === 'addNote' ? 'notes' : (call.name === 'addTask' ? 'tasks' : 'calendarEvents');
                                                const item: any = { id: `${coll}-${Date.now()}`, title, createdAt: Date.now(), lastModified: Date.now() };
                                                if (content) item.content = content;
                                                if (description) item.description = description;
                                                if (priority) item.priority = priority;
                                                if (date) item.date = new Date(date).getTime() || Date.now();
                                                const { FieldValue } = await import('firebase-admin/firestore');
                                                await firestore.collection('users').doc(uid).collection('projects').doc(projectId).update({ [coll]: FieldValue.arrayUnion(item) });
                                                result = { success: true, id: item.id };
                                            }
                                        }

                                        toolResponses.push({
                                            id: call.id,
                                            name: call.name,
                                            response: result
                                        });
                                    }
                                    // Send all tool responses back to Gemini
                                    try {
                                        geminiSession.sendToolResponse({ functionResponses: toolResponses });
                                    } catch (trErr) {
                                        console.error('[WS-Live] sendToolResponse error:', trErr);
                                    }
                                }
                            },
                            onerror: (e: any) => {
                                console.error('[WS-Live] Gemini session error:', e?.message || e);
                            },
                            onclose: (e: any) => {
                                console.log('[WS-Live] Gemini session closed:', e?.reason || '');
                                geminiSession = null;
                            }
                        }
                    });
                } catch (connectErr) {
                    console.error('[WS-Live] Failed to connect to Gemini Live:', connectErr);
                    wsTwilio.close();
                }

            // ── 2. Inbound audio from Twilio → forward to Gemini ────────────
            } else if (data.event === 'media') {
                if (data.media?.track === 'inbound' && data.media?.payload) {
                    const audioMsg = (() => {
                        try {
                            const mulaw = Buffer.from(data.media.payload, 'base64');
                            const pcm8 = audioUtils.mulawToPcm(mulaw);
                            const pcm16 = audioUtils.resample8To16(pcm8);
                            return {
                                audio: {
                                    data: Buffer.from(pcm16.buffer).toString('base64'),
                                    mimeType: 'audio/pcm;rate=16000'
                                }
                            };
                        } catch { return null; }
                    })();

                    if (audioMsg) {
                        if (sessionReady && geminiSession) {
                            try { geminiSession.sendRealtimeInput(audioMsg); } catch (_) {}
                        } else {
                            // Buffer up to 50 chunks while session is initialising
                            if (messageQueue.length < 50) messageQueue.push(audioMsg);
                        }
                    }
                }

            // ── 3. Stream stopped ────────────────────────────────────────────
            } else if (data.event === 'stop') {
                console.log(`[WS-Live] Twilio stream stopped: ${streamSid}`);
                if (geminiSession) { try { geminiSession.close(); } catch (_) {} }
            }
        } catch (err) {
            console.error('[WS-Live] Message handler error:', err);
        }
    });

    wsTwilio.on('close', () => {
        console.log(`[WS-Live] Twilio WebSocket closed for stream: ${streamSid}`);
        if (geminiSession) { try { geminiSession.close(); } catch (_) {} }
    });

    wsTwilio.on('error', (err) => {
        console.error('[WS-Live] Twilio WebSocket error:', err);
    });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

// IMPORTANT: Start listening FIRST, before Firebase init.
// This ensures the server meets Twilio's 15s window even on cold starts.
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[VoiceServer] Listening on port ${PORT}`);
    console.log(`[VoiceServer] WebSocket URL for Twilio: ${WS_URL}`);
    // Initialize Firebase AFTER the server is already accepting connections
    setImmediate(() => initFirebase());
});
