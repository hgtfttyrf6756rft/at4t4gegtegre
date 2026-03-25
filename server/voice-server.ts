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
const sessions: { [callSid: string]: { contents: any[], uid?: string, agentName?: string, agentInstructions?: string, systemPrompt?: string } } = {};

// Helper to normalize phone numbers
function normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    return phone.replace(/[^\d+]/g, '');
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

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect action="${APP_URL}/api/agent?op=webhook">
        <ConversationRelay 
            url="${WS_URL}" 
            welcomeGreeting="${escapeXmlAttr(welcomeGreeting)}"
            ttsProvider="${ttsProvider}"
            voice="${voice}"
        >
            <Parameter name="to" value="${escapeXmlAttr(to)}" />
            <Parameter name="from" value="${escapeXmlAttr(from)}" />
        </ConversationRelay>
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

            const WS_NOTE_URL = DOMAIN ? `wss://${DOMAIN}/ws-note` : `ws://localhost:${PORT}/ws-note`;

            let welcomeGreeting = 'Hello! How can I help you today? You can ask me about anything you have noted down.';
            let voice = 'en-US-Journey-F';

            try {
                const userData = await getUserConfig(to);
                const normalizedTarget = normalizePhoneNumber(to);
                const activeConfig = userData?.agentPhoneConfigs?.[to] || userData?.agentPhoneConfigs?.[normalizedTarget] || userData?.agentPhoneConfig;
                
                if (activeConfig?.enabled) {
                    welcomeGreeting = activeConfig.systemPrompt 
                        ? (activeConfig.welcomeGreeting || welcomeGreeting)
                        : welcomeGreeting;
                    voice = resolveVoice(activeConfig);
                }
            } catch (e) {
                console.error('[TwiML-Note] Error fetching user config:', e);
            }

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect action="${APP_URL}/api/agent?op=webhook">
        <ConversationRelay 
            url="${WS_NOTE_URL}" 
            welcomeGreeting="${escapeXmlAttr(welcomeGreeting)}"
            ttsProvider="Google"
            voice="${voice}"
        >
            <Parameter name="to" value="${escapeXmlAttr(to)}" />
            <Parameter name="from" value="${escapeXmlAttr(from)}" />
        </ConversationRelay>
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
            
            console.log(`[TwiML-Setup] Received redirect for call to ${to} from ${from} (${callerCity}, ${callerState})`);

            const WS_SETUP_URL = DOMAIN ? `wss://${DOMAIN}/ws-setup` : `ws://localhost:${PORT}/ws-setup`;

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect action="${APP_URL}/api/agent?op=webhook">
        <ConversationRelay 
            url="${WS_SETUP_URL}" 
             welcomeGreeting="Welcome to Freshfront! Please wait while I connect you to our agent setup assistant."
            ttsProvider="Google"
            voice="en-US-Journey-F"
        >
            <Parameter name="to" value="${escapeXmlAttr(to)}" />
            <Parameter name="from" value="${escapeXmlAttr(from)}" />
            <Parameter name="callerCity" value="${escapeXmlAttr(callerCity)}" />
            <Parameter name="callerState" value="${escapeXmlAttr(callerState)}" />
            <Parameter name="callerCountry" value="${escapeXmlAttr(callerCountry)}" />
        </ConversationRelay>
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
            const WS_PROJECTS_URL = DOMAIN ? `wss://${DOMAIN}/ws-projects` : `ws://localhost:${PORT}/ws-projects`;

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect action="${APP_URL}/api/agent?op=webhook">
        <ConversationRelay
            url="${WS_PROJECTS_URL}"
            welcomeGreeting="Hey! Welcome back. You can create projects, add notes, tasks, calendar events, or generate images. What would you like to do?"
            ttsProvider="Google"
            voice="en-US-Journey-F"
        >
            <Parameter name="to" value="${escapeXmlAttr(to)}" />
            <Parameter name="from" value="${escapeXmlAttr(from)}" />
        </ConversationRelay>
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
const wss = new WebSocketServer({ noServer: true });
const wssNote = new WebSocketServer({ noServer: true });
const wssSetup = new WebSocketServer({ noServer: true });
const wssProjects = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url || '').pathname;

    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else if (pathname === '/ws-note') {
        wssNote.handleUpgrade(request, socket, head, (ws) => {
            wssNote.emit('connection', ws, request);
        });
    } else if (pathname === '/ws-setup') {
        wssSetup.handleUpgrade(request, socket, head, (ws) => {
            wssSetup.emit('connection', ws, request);
        });
    } else if (pathname === '/ws-projects') {
        wssProjects.handleUpgrade(request, socket, head, (ws) => {
            wssProjects.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (wsMain: WebSocket) => {
    let callSid: string | null = null;
    let callerNumber: string = '';

    wsMain.on('message', async (message: string) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'setup') {
                callSid = data.callSid;
                const to = data.customParameters?.to || '';
                callerNumber = data.customParameters?.from || '';

                console.log(`[WS] Setup for call: ${callSid} (To: ${to}, From: ${callerNumber})`);

                let systemPrompt = DEFAULT_SYSTEM_PROMPT;
                let uid = '';
                let agentInstructions = '';

                const userData = await getUserConfig(to);
                if (userData) {
                    uid = userData.uid;
                    const normalizedTarget = normalizePhoneNumber(to);
                    const config = userData.agentPhoneConfigs?.[to] || userData.agentPhoneConfigs?.[normalizedTarget] || userData.agentPhoneConfig;

                    if (config?.enabled) {
                        let customInstructions = config.systemPrompt || '';
                        let projectListContext = '';

                        if (config.mode === 'leads' || config.leadCaptureEnabled) {
                            if (config.leadFields?.length > 0) {
                                const fields = config.leadFields.map((f: any) => `${f.name}${f.required ? ' (required)' : ''}`).join(', ');
                                customInstructions += `\n\nLEAD CAPTURE TASK: Your primary goal is to politely collect the following information from the caller: ${fields}. 
                                Once you have collected the required information, acknowledge it and call the 'saveCapturedLead' tool to save the data. 
                                Be natural and conversational while asking for these details. 
                                DO NOT share any internal project data or user information with the caller.`;
                            }
                            if (config.appointmentBookingEnabled) {
                                customInstructions += `\n\nAPPOINTMENT BOOKING: After collecting the caller's information, offer to book an appointment for them. Ask what date and time works best. Once they confirm, call the 'bookAppointment' tool with an ISO 8601 dateTimeIso, their preferred duration in minutes (default 60), and all collected lead details in the notes field.`;
                            }
                            console.log(`[WS] Lead Capture mode for user ${uid}. Restricting context.`);
                        } else {
                            console.log(`[WS] Normal assistant mode for user ${uid}. Injecting project context.`);
                            const firestore = initFirebase();
                            if (firestore) {
                                const projectsSnapshot = await firestore.collection('users').doc(uid).collection('projects')
                                    .orderBy('lastModified', 'desc').limit(10).get();

                                const projectList = projectsSnapshot.docs.map(d => {
                                    const pData = d.data();
                                    return `"${pData.name}" (ID: ${d.id})${pData.description ? ` - ${pData.description.substring(0, 50)}` : ''}`;
                                });

                                projectListContext = projectList.length > 0
                                    ? `\n\nUSER'S PROJECTS:\n${projectList.join('\n')}`
                                    : `\n\nUSER'S PROJECTS: The user has no projects yet.`;

                                const userProfileInfo = `\n\nUSER PROFILE: ${userData.displayName || 'Unnamed User'}${userData.description ? ` - ${userData.description}` : ''}`;
                                projectListContext = userProfileInfo + projectListContext;
                            }
                        }

                        systemPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\nUSER'S AGENT INSTRUCTIONS: ${customInstructions}${projectListContext}`;
                        agentInstructions = customInstructions;
                        console.log(`[WS] Loaded instructions for user ${uid}.`);
                    } else {
                        console.log(`[WS] User ${uid} found but Phone Agent is DISABLED.`);
                    }
                } else {
                    console.warn(`[WS] No user found for phone number: ${to}`);
                }

                sessions[callSid!] = {
                    contents: [],
                    uid,
                    agentInstructions,
                    systemPrompt
                };

            } else if (data.type === 'prompt') {
                if (!callSid || !sessions[callSid]) return;

                const userPrompt = data.voicePrompt || data.textPrompt;
                console.log(`[WS] User (${callSid}): ${userPrompt}`);

                const session = sessions[callSid];
                session.contents.push({ role: 'user', parts: [{ text: userPrompt }] });

                try {
                    const firestore = initFirebase();
                    const userData = (session.uid && firestore) ? await getUserConfig(callerNumber) : null;
                    const normalizedTarget = normalizePhoneNumber(callerNumber);
                    const config = userData?.agentPhoneConfigs?.[callerNumber] || userData?.agentPhoneConfigs?.[normalizedTarget] || userData?.agentPhoneConfig;
                    const leadCaptureEnabled = config?.mode === 'leads' || !!config?.leadCaptureEnabled;

                    const response = await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: session.contents,
                        config: {
                            systemInstruction: session.systemPrompt,
                            tools: leadCaptureEnabled ? [leadCaptureTool] : []
                        }
                    });

                    if (response.candidates?.[0]?.content) {
                        session.contents.push(response.candidates[0].content);
                    }

                    let responseText = '';
                    const parts = response.candidates?.[0]?.content?.parts || [];

                    for (const part of parts) {
                        if (part.text) {
                            responseText += part.text;
                        }

                        if (part.functionCall) {
                            const call = part.functionCall;
                            if (call.name === 'saveCapturedLead') {
                                console.log(`[WS] Saving Lead for call ${callSid}:`, call.args);
                                const firestore2 = initFirebase();
                                if (session.uid && firestore2) {
                                    try {
                                        await firestore2.collection('users').doc(session.uid).collection('phoneAgentLeads').add({
                                            callerNumber,
                                            data: (call.args as any).data,
                                            agentInstructions: session.agentInstructions,
                                            timestamp: Date.now()
                                        });
                                        console.log(`[WS] Lead saved to Firestore for user ${session.uid}`);
                                    } catch (fsErr) {
                                        console.error("[WS] Error saving lead to Firestore:", fsErr);
                                    }
                                }

                                session.contents.push({
                                    role: 'user',
                                    parts: [{
                                        functionResponse: {
                                            name: 'saveCapturedLead',
                                            response: { success: true }
                                        }
                                    }]
                                });

                                const followup = await ai.models.generateContent({
                                    model: 'gemini-2.0-flash',
                                    contents: session.contents,
                                    config: {
                                        systemInstruction: session.systemPrompt,
                                        tools: [leadCaptureTool]
                                    }
                                });

                                if (followup.candidates?.[0]?.content) {
                                    session.contents.push(followup.candidates[0].content);
                                    const textPart = followup.candidates[0].content.parts.find((p: any) => p.text);
                                    if (textPart?.text) {
                                        responseText = textPart.text;
                                    }
                                }
                            } else if (call.name === 'transferToHuman') {
                                console.log(`[WS] Agent requested handoff to human for call ${callSid}`);
                                wsMain.send(JSON.stringify({
                                    type: "handoff",
                                    handoffData: JSON.stringify({ reason: "transferToHuman requested" })
                                }));
                                // After handoff is sent, ConversationRelay will end and Twilio will hit the action URL
                                return;
                            } else if (call.name === 'bookAppointment') {
                                console.log(`[WS] bookAppointment tool called for call ${callSid}:`, call.args);
                                const apptArgs = call.args as any;
                                let bookingResult: any = { success: false, error: 'Appointment booking not configured.' };

                                try {
                                    // 1. Get the agent config to check if booking is enabled
                                    const agentUserData = await getUserConfig(data.customParameters?.to || callerNumber);
                                    const normalizedTo = normalizePhoneNumber(data.customParameters?.to || callerNumber);
                                    const agentCfg = agentUserData?.agentPhoneConfigs?.[data.customParameters?.to] || agentUserData?.agentPhoneConfigs?.[normalizedTo] || agentUserData?.agentPhoneConfig;

                                    if (agentCfg?.appointmentBookingEnabled && agentUserData?.uid) {
                                        // 2. Get the calendar OAuth token from Firestore
                                        const firestore3 = initFirebase();
                                        if (!firestore3) throw new Error('Firestore unavailable');

                                        const calTokenSnap = await firestore3.doc(`users/${agentUserData.uid}/integrations/googleCalendar`).get();
                                        const refreshToken = calTokenSnap?.data()?.refreshToken;
                                        if (!refreshToken) throw new Error('Google Calendar not connected');

                                        // 3. Refresh access token
                                        const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || '';
                                        const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || '';
                                        if (!clientId || !clientSecret) throw new Error('Missing Google OAuth credentials');

                                        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                            body: new URLSearchParams({
                                                client_id: clientId,
                                                client_secret: clientSecret,
                                                refresh_token: refreshToken,
                                                grant_type: 'refresh_token',
                                            }).toString(),
                                        });
                                        if (!tokenRes.ok) throw new Error(`Token refresh failed: ${tokenRes.status}`);
                                        const tokenJson: any = await tokenRes.json();
                                        const accessToken = tokenJson.access_token;
                                        if (!accessToken) throw new Error('No access_token in response');

                                        // 4. Build and create the calendar event
                                        const startMs = new Date(apptArgs.dateTimeIso).getTime();
                                        const durationMs = (apptArgs.durationMinutes || 60) * 60 * 1000;
                                        const endMs = startMs + durationMs;
                                        const calendarId = agentCfg.calendarId || 'primary';

                                        const eventBody = {
                                            summary: `📞 Appointment – ${callerNumber}`,
                                            description: `Booked via phone agent.\n\nLead details:\n${apptArgs.notes}`,
                                            start: { dateTime: new Date(startMs).toISOString() },
                                            end: { dateTime: new Date(endMs).toISOString() },
                                        };

                                        const calRes = await fetch(
                                            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
                                            {
                                                method: 'POST',
                                                headers: {
                                                    Authorization: `Bearer ${accessToken}`,
                                                    'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify(eventBody),
                                            }
                                        );

                                        if (!calRes.ok) {
                                            const errText = await calRes.text();
                                            throw new Error(`Calendar API error: ${calRes.status} ${errText}`);
                                        }

                                        const calData: any = await calRes.json();
                                        bookingResult = { success: true, eventId: calData.id, htmlLink: calData.htmlLink };
                                        console.log(`[WS] Appointment booked: ${calData.htmlLink}`);
                                    } else {
                                        bookingResult = { success: false, error: 'Appointment booking is not enabled for this agent.' };
                                    }
                                } catch (bookErr: any) {
                                    console.error('[WS] bookAppointment error:', bookErr);
                                    bookingResult = { success: false, error: bookErr.message || 'Failed to book appointment.' };
                                }

                                session.contents.push({
                                    role: 'user',
                                    parts: [{ functionResponse: { name: 'bookAppointment', response: bookingResult } }]
                                });

                                // Re-call Gemini so it can verbally confirm or apologize
                                const apptFollowup = await ai.models.generateContent({
                                    model: 'gemini-2.0-flash',
                                    contents: session.contents,
                                    config: { systemInstruction: session.systemPrompt, tools: [leadCaptureTool] }
                                });
                                if (apptFollowup.candidates?.[0]?.content) {
                                    session.contents.push(apptFollowup.candidates[0].content);
                                    const textPart = apptFollowup.candidates[0].content.parts.find((p: any) => p.text);
                                    if (textPart?.text) responseText = textPart.text;
                                }
                            }
                        }
                    }

                    wsMain.send(JSON.stringify({
                        type: 'text',
                        token: responseText,
                        last: true
                    }));

                    console.log(`[WS] Gemini (${callSid}): ${responseText}`);
                } catch (apiError) {
                    console.error(`[WS] Gemini API Error for ${callSid}:`, apiError);
                    wsMain.send(JSON.stringify({
                        type: 'text',
                        token: "I'm sorry, I encountered an error processing your request.",
                        last: true
                    }));
                }
            } else if (data.type === 'interrupt') {
                console.log(`[WS] Interruption for call ${callSid}`);
            }
        } catch (e) {
            console.error('[WS] Error:', e);
        }
    });

    wsMain.on('close', () => {
        console.log(`[WS] Closed for call: ${callSid}`);
        if (callSid && sessions[callSid]) {
            delete sessions[callSid];
        }
    });
});

// ─── Note Mode WebSocket (/ws-note) — Gemini Live API Bridge ─────────────────
// This handler is used when the user has configured their phone agent in Note Mode.
wssNote.on('connection', (wsNote: WebSocket) => {
    let callSid: string | null = null;

    wsNote.on('message', async (message: string) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'setup') {
                callSid = data.callSid;
                const to = data.customParameters?.to || '';
                const from = data.customParameters?.from || '';
                console.log(`[WS-Note] Setup for call: ${callSid} (To: ${to}, From: ${from})`);

                // Fetch all SMS notes for this user from Firestore
                let notesContext = 'The user has not sent any notes yet.';
                let customSystemPrompt = '';
                let notesCount = 0;
                const firestore = initFirebase();
                if (firestore) {
                    try {
                        // Find user by phone number
                        const normalizedTarget = normalizePhoneNumber(to);
                        const noPlusTarget = normalizedTarget.startsWith('+') ? normalizedTarget.substring(1) : normalizedTarget;
                        const searchValues = [to, normalizedTarget, noPlusTarget, `+${noPlusTarget}`];
                        const uniqueValues = [...new Set(searchValues)].slice(0, 10);
                        
                        let userSnap = await firestore.collection('users')
                            .where('agentPhoneNumbersList', 'array-contains-any', uniqueValues)
                            .limit(1).get();
                        
                        if (userSnap.empty) {
                            userSnap = await firestore.collection('users')
                                .where('agentPhoneNumber', 'in', uniqueValues)
                                .limit(1).get();
                        }
                        
                        if (!userSnap.empty) {
                            const userDoc = userSnap.docs[0];
                            const uid = userDoc.id;
                            const userData = userDoc.data();
                            const config = userData?.agentPhoneConfigs?.[to] || userData?.agentPhoneConfigs?.[normalizedTarget] || userData?.agentPhoneConfig;
                            customSystemPrompt = config?.systemPrompt || '';

                            // Fetch all notes
                            const notesSnap = await firestore.collection('users').doc(uid)
                                .collection('phoneAgentNotes')
                                .orderBy('timestamp', 'desc')
                                .limit(200)
                                .get();

                            notesCount = notesSnap.size;

                            if (!notesSnap.empty) {
                                const notesList = notesSnap.docs.map(d => {
                                    const n = d.data();
                                    const date = new Date(n.timestamp).toLocaleString();
                                    return `[${date}] ${n.body}`;
                                });
                                notesContext = notesList.join('\n');
                                console.log(`[WS-Note] Loaded ${notesList.length} notes for user ${uid}`);
                            } else {
                                console.log(`[WS-Note] No notes yet for user ${uid}`);
                            }
                        } else {
                            console.warn(`[WS-Note] No user found for phone number: ${to}`);
                        }
                    } catch (err) {
                        console.error('[WS-Note] Error fetching notes:', err);
                    }
                }

                // Build the system instruction with note RAG context
                const noteSystemPrompt = [
                    `You are a personal voice assistant with access to the user's notes. These notes were sent as SMS text messages to this number.`,
                    `You MUST answer questions based on the content of these notes.`,
                    `This is a live phone call, so be concise and speak naturally. Do not use markdown, bullet points, asterisks, or emojis.`,
                    customSystemPrompt ? `\nAdditional instructions: ${customSystemPrompt}` : '',
                    `\n\n--- USER'S NOTES (${notesCount} total) ---\n${notesContext}\n--- END OF NOTES ---`
                ].filter(Boolean).join('\n');

                // Store the system prompt on the WebSocket connection for use in prompt handling
                (wsNote as any).__noteSystemPrompt = noteSystemPrompt;
                console.log(`[WS-Note] System prompt ready (${noteSystemPrompt.length} chars)`);

            } else if (data.type === 'prompt') {
                const userPrompt = data.voicePrompt || data.textPrompt || '';
                const systemPrompt = (wsNote as any).__noteSystemPrompt || '';
                console.log(`[WS-Note] User (${callSid}): ${userPrompt}`);

                try {
                    // Use generateContent (single-turn) since Twilio ConversationRelay
                    // manages the audio loop — we just respond with text each turn
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                        config: { systemInstruction: systemPrompt }
                    });

                    const responseText = response.candidates?.[0]?.content?.parts
                        ?.filter((p: any) => p.text)
                        .map((p: any) => p.text)
                        .join('') || "I couldn't find an answer in your notes.";

                    wsNote.send(JSON.stringify({ type: 'text', token: responseText, last: true }));
                    console.log(`[WS-Note] Gemini (${callSid}): ${responseText.substring(0, 80)}...`);
                } catch (apiError) {
                    console.error(`[WS-Note] Gemini API Error for ${callSid}:`, apiError);
                    wsNote.send(JSON.stringify({ type: 'text', token: "I'm sorry, I had trouble looking up your notes.", last: true }));
                }

            } else if (data.type === 'interrupt') {
                console.log(`[WS-Note] Interruption for call ${callSid}`);
            }
        } catch (e) {
            console.error('[WS-Note] Error:', e);
        }
    });

    wsNote.on('close', () => {
        console.log(`[WS-Note] Closed for call: ${callSid}`);
    });
});

// ─── Setup Mode WebSocket (/ws-setup) — Gemini Live API Bridge ─────────────────
wssSetup.on('connection', (wsSetup: WebSocket) => {
    let callSid: string | null = null;
    let callerNumber: string = '';

    wsSetup.on('message', async (message: string) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'setup') {
                callSid = data.callSid;
                const to = data.customParameters?.to || '';
                callerNumber = data.customParameters?.from || '';
                const callerCity = data.customParameters?.callerCity || '';
                const callerState = data.customParameters?.callerState || '';
                const callerCountry = data.customParameters?.callerCountry || '';

                console.log(`[WS-Setup] Setup for call: ${callSid} (To: ${to}, From: ${callerNumber}, Location: ${callerCity}, ${callerState})`);

                const locationStr = [callerCity, callerState, callerCountry].filter(Boolean).join(', ');
                const locationContext = locationStr 
                    ? `The caller is located in or near: ${locationStr}.\nBefore assigning the final number, use the 'searchAreaCodes' tool with region code '${callerState}' to look up available area codes in their state, and politely ASK the user which one they prefer from the available options.` 
                    : `Before assigning the final number, politely ask the user what state/province they are in, use 'searchAreaCodes' to look up available area codes there, and ASK the user which one they prefer.`;

                let managementContext = "";
                const userData = await getUserConfig(callerNumber);
                if (userData && userData.agentPhoneNumbersList?.length > 0) {
                    const numbers = userData.agentPhoneNumbersList.join(', ');
                    managementContext = `
EXISTING USER DETECTED: This user already has the following agent numbers: ${numbers}.
Start by acknowledging their existing agents. 
Introduce a "Management Menu":
- Ask if they want to create a NEW agent.
- Ask if they want to DELETE an existing agent.
- Ask if they want to REPLACE one of their existing numbers with a new one.
- Ask if they want to see ANALYTICS (e.g. lead counts or common caller questions).
If they want to delete or replace, you MUST use the 'deleteAgent' tool. For analytics, use 'getAgentAnalytics'.`;
                }

                const systemPrompt = `You are the Freshfront Agent Setup Assistant. You are talking to a user on the phone. 
${managementContext || "Start by warmly welcoming them and asking which type of phone agent they want:"}

Option 1 — LEAD CAPTURE AGENT: An AI phone agent for their business that answers calls and collects caller information (name, phone number, inquiry, etc.) and forwards leads to the business owner.

Option 2 — INFORMATIONAL HOTLINE: A personal AI hotline that answers questions based on notes the owner sends to it via text message. Great for information lines, FAQs, or personal knowledge bases. No business account required.

Based on their choice, collect the required details:

For LEAD CAPTURE (agentType='leads'):
1. Company Name
2. Company Description
3. Website (optional, ask once)
4. Company Email (optional, ask once)
5. The product or service they provide
6. What data to collect from callers (e.g. Name, Phone Number, Inquiry)
7. Where to send leads: email, sms, or app (say 'dashboard' maps to app)
8. Human Handoff (Ask the user if they want to optionally allow callers to be transferred to a real human during a call. If yes, ask them for the phone number where calls should be forwarded.)
9. Automated Follow-up SMS (Ask them if they want to send an automatic text to every lead after the call ends, e.g. a booking link or a thank you message. If yes, ask them for the exact message body.)

CRITICAL ACCURACY FOR WEBSITE:
When the user provides their business website URL, you MUST ask them to **spell it out** (e.g. "Could you spell that out for me to make sure I got it right? A-B-C-dot-com"). This is crucial for correctly configuring their agent.

For INFORMATIONAL HOTLINE (agentType='hotline'):
1. A friendly label or name for their hotline (optional — if they don't have one, use their business or personal name, or just say 'Your Hotline')

LOCATION AWARENESS:
${locationContext}
If no area codes are available in their state, ask if another nearby state or region works for them.

CRITICAL INSTRUCTIONS:
- You are on a phone call. Be conversational, concise, and friendly. No markdown.
- Ask one or two questions at a time — do not dump all questions at once.
- Only call 'provisionAgent' AFTER they have explicitly chosen an area code. Pass their chosen area code as the 'areaCode' argument.
- AFTER SUCCESSFUL PROVISIONING: You MUST instruct the caller to go to freshfront.co to create an account. Explain that they need to sign up with their phone number to manage their new agent, view leads, and enable context training via SMS.
- If the caller sounds unsure, briefly explain the difference again.
- Never use asterisks, bullet points, or emojis in your speech.`;

                sessions[callSid!] = {
                    contents: [],
                    systemPrompt,
                    uid: userData?.uid
                };

                // Trigger Gemini to start the conversation automatically
                wsSetup.emit('message', JSON.stringify({
                    type: 'prompt',
                    textPrompt: "Hi, I just connected. Please introduce yourself and start the setup process according to your instructions."
                }));

            } else if (data.type === 'prompt') {
                if (!callSid || !sessions[callSid]) return;

                const userPrompt = data.voicePrompt || data.textPrompt;
                console.log(`[WS-Setup] User (${callSid}): ${userPrompt}`);

                const session = sessions[callSid];
                session.contents.push({ role: 'user', parts: [{ text: userPrompt }] });

                try {
                    let response = await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: session.contents,
                        config: {
                            systemInstruction: session.systemPrompt,
                            tools: [voiceSetupTools]
                        }
                    });

                    if (response.candidates?.[0]?.content) {
                        session.contents.push(response.candidates[0].content);
                    }

                    let responseText = '';
                    let anyToolCalled = false;
                    const parts = response.candidates?.[0]?.content?.parts || [];

                    for (const part of parts) {
                        if (part.text) {
                            responseText += part.text;
                        }

                        if (part.functionCall) {
                            anyToolCalled = true;
                            const call = part.functionCall;
                            
                            if (call.name === 'searchAreaCodes') {
                                const args = call.args as any;
                                console.log(`[WS-Setup] Searching area codes for: ${args.region}`);
                                
                                wsSetup.send(JSON.stringify({
                                    type: 'text', token: "Let me check what area codes are available in your region...", last: false
                                }));

                                try {
                                    const result = await phoneAgentService.searchAvailableAreaCodes(args.region);
                                    session.contents.push({
                                        role: 'user',
                                        parts: [{
                                            functionResponse: {
                                                name: 'searchAreaCodes',
                                                response: result
                                            }
                                        }]
                                    });
                                } catch (e: any) {
                                    console.error('[WS-Setup] searchAreaCodes tool error:', e);
                                    session.contents.push({
                                        role: 'user',
                                        parts: [{ functionResponse: { name: 'searchAreaCodes', response: { error: e.message }}}]
                                    });
                                }
                            } else if (call.name === 'deleteAgent') {
                                const args = call.args as any;
                                const targetNumber = normalizePhoneNumber(args.phoneNumber);
                                console.log(`[WS-Setup] Requested delete for: ${targetNumber} (Caller: ${callerNumber}, UID: ${session.uid})`);

                                wsSetup.send(JSON.stringify({
                                    type: 'text', token: "I'm releasing that phone number for you now. Just a moment...", last: false
                                }));

                                try {
                                    let success = false;
                                    const firestore = initFirebase();
                                    
                                    // Verify ownership if possible
                                    const userData = session.uid ? await getUserConfig(callerNumber) : null;
                                    const isOwner = userData?.agentPhoneNumbersList?.includes(targetNumber);

                                    if (isOwner || !session.uid) {
                                        const released = await phoneAgentService.releaseTwilioNumber(targetNumber);
                                        if (released && userData) {
                                            // Handle Firestore cleanup for existing user
                                            const newList = userData.agentPhoneNumbersList.filter((n: string) => n !== targetNumber);
                                            const newConfigs = { ...userData.agentPhoneConfigs };
                                            delete newConfigs[targetNumber];
                                            
                                            await firestore!.collection('users').doc(userData.uid).update({
                                                agentPhoneNumbersList: newList,
                                                agentPhoneConfigs: newConfigs
                                            });
                                            success = true;
                                        } else if (released) {
                                            // Handle cleanup for unclaimed agents
                                            await firestore!.collection('unclaimedAgents').doc(targetNumber).delete();
                                            success = true;
                                        }
                                    }

                                    session.contents.push({
                                        role: 'user',
                                        parts: [{
                                            functionResponse: {
                                                name: 'deleteAgent',
                                                response: { success }
                                            }
                                        }]
                                    });
                                } catch (err: any) {
                                    console.error('[WS-Setup] deleteAgent tool error:', err);
                                    session.contents.push({
                                        role: 'user',
                                        parts: [{
                                            functionResponse: {
                                                name: 'deleteAgent',
                                                response: { success: false, error: err.message || "Failed to delete agent." }
                                            }
                                        }]
                                    });
                                }
                            } else if (call.name === 'getAgentAnalytics') {
                                anyToolCalled = true;
                                const type = call.args.type;
                                const timeRange = call.args.timeRange || 'week';
                                console.log(`[WS-Setup] Fetching analytics: ${type} for ${timeRange} (${callerNumber})`);

                                const firestore = initFirebase();
                                let resultContext = "";

                                        if (firestore && session.uid) {
                                    try {
                                        const now = new Date();
                                        let startTime = new Date();
                                        if (timeRange === 'today') startTime.setHours(0, 0, 0, 0);
                                        else if (timeRange === 'week') startTime.setDate(now.getDate() - 7);
                                        else if (timeRange === 'month') startTime.setDate(now.getDate() - 30);

                                        const startTs = startTime.getTime();

                                        if (type === 'leads') {
                                            const leadsRef = firestore.collection('users').doc(session.uid).collection('phoneAgentLeads');
                                            const snapshot = await leadsRef.where('timestamp', '>=', startTs).get();
                                            const count = snapshot.size;
                                            
                                            const recentLeads: string[] = [];
                                            snapshot.docs.slice(0, 3).forEach(doc => {
                                                const d = doc.data();
                                                recentLeads.push(`${d.name || 'Unknown'} (${d.phoneNumber || 'No phone'}) - ${d.inquiry || 'No inquiry'}`);
                                            });

                                            resultContext = `You have received ${count} leads in the last ${timeRange}. 
                                                            ${recentLeads.length > 0 ? "Recent leads include: " + recentLeads.join('; ') : ""}`;
                                        } else if (type === 'conversations') {
                                            const historyRef = firestore.collection('users').doc(session.uid).collection('phoneAgentHistory');
                                            const snapshot = await historyRef.where('timestamp', '>=', startTs).limit(20).get();
                                            
                                            const transcripts = snapshot.docs.map(doc => doc.data().text || "").filter(Boolean);
                                            resultContext = `Analyzed ${snapshot.size} recent message exchanges. Themes detected: ${transcripts.length > 0 ? "Callers are mostly saying: " + transcripts.join(' | ').substring(0, 300) + "..." : "No clear themes found yet."}`;
                                        }
                                    } catch (err) {
                                        console.error("[WS-Setup] Analytics error:", err);
                                        resultContext = "Error fetching analytics data.";
                                    }
                                } else {
                                    resultContext = "User account not linked or Firestore unavailable. Analytics unavailable.";
                                }

                                session.contents.push({
                                    role: 'user',
                                    parts: [{
                                        functionResponse: {
                                            name: call.name,
                                            response: { content: resultContext }
                                        }
                                    }]
                                });
                            } else if (call.name === 'provisionAgent') {
                                const args = call.args as any;
                                console.log(`[WS-Setup] Provisioning Agent for ${callerNumber}: type=${args.agentType}`, args);

                                wsSetup.send(JSON.stringify({
                                    type: 'text',
                                    token: args.agentType === 'hotline'
                                        ? "Perfect! I'm reserving your informational hotline number now. Just a moment!"
                                        : "I'm setting up your lead capture agent now. This will take just a moment while I reserve your new phone number.",
                                    last: false
                                }));

                                try {
                                    const availableNumbers = await phoneAgentService.searchTwilioNumbers(args.areaCode);
                                    if (!availableNumbers || availableNumbers.length === 0) {
                                        throw new Error(`No phone numbers available to purchase currently${args.areaCode ? ` in area code ${args.areaCode}` : ''}.`);
                                    }
                                    const numberToBuy = availableNumbers[0].phone_number;
                                    
                                    const newTwilioNumber = await phoneAgentService.buyTwilioNumber(
                                        numberToBuy,
                                        APP_URL,
                                        `${APP_URL}/api/agent`
                                    );
                                    console.log(`[WS-Setup] New Number Provisioned: ${newTwilioNumber}`);

                                    const firestore = initFirebase();
                                    let userRef: FirebaseFirestore.DocumentReference | null = null;
                                    let uid = '';
                                    let userData: any = {};

                                    if (firestore) {
                                        const normalizedCaller = normalizePhoneNumber(callerNumber);
                                        const noPlusCaller = normalizedCaller.startsWith('+') ? normalizedCaller.substring(1) : normalizedCaller;
                                        const searchValues = [callerNumber, normalizedCaller, noPlusCaller, `+${noPlusCaller}`];
                                        const uniqueValues = [...new Set(searchValues)].slice(0, 5);

                                        let userSnap = await firestore.collection('users')
                                            .where('personalPhoneNumber', 'in', uniqueValues)
                                            .limit(1).get();

                                        if (!userSnap.empty) {
                                            userRef = userSnap.docs[0].ref;
                                            uid = userSnap.docs[0].id;
                                            userData = userSnap.docs[0].data();
                                            console.log(`[WS-Setup] Matched caller to user ${uid}`);
                                        }
                                    }

                                    let newConfig: any;
                                    if (args.agentType === 'hotline') {
                                        newConfig = {
                                            enabled: true,
                                            mode: 'notes',
                                            welcomeGreeting: `Hello! Ask me anything — I'll answer based on the notes I've been given.`,
                                            label: args.label || 'My Hotline',
                                            ownerPhone: callerNumber
                                        };
                                    } else {
                                        const leadFields = (args.dataToCollect || []).map((fieldName: string) => ({
                                            id: Math.random().toString(36).substr(2, 9),
                                            name: fieldName,
                                            required: true
                                        }));
                                        newConfig = {
                                            enabled: true,
                                            mode: 'leads',
                                            systemPrompt: `You are the lead capture phone agent for ${args.companyName}. ${args.description}. You offer: ${args.productService}. Website: ${args.website || 'N/A'}. Email: ${args.email || 'N/A'}. Be helpful, extremely brief, and professional.`,
                                            leadCaptureEnabled: true,
                                            leadFields: leadFields,
                                            leadDestination: args.leadDestination || 'app',
                                            humanHandoffEnabled: !!args.humanHandoffEnabled,
                                            humanHandoffNumber: args.humanHandoffNumber || '',
                                            followUpSms: args.followUpSms || ''
                                        };
                                    }

                                    if (userRef) {
                                        const newList = [...(userData.agentPhoneNumbersList || [])];
                                        if (!newList.includes(newTwilioNumber)) newList.push(newTwilioNumber);
                                        const allConfigs = { ...(userData.agentPhoneConfigs || {}) };
                                        allConfigs[newTwilioNumber] = newConfig;
                                        await userRef.update({
                                            agentPhoneNumbersList: newList,
                                            agentPhoneConfigs: allConfigs
                                        });
                                        console.log(`[WS-Setup] Saved new config to user ${uid}`);
                                    } else if (firestore) {
                                        await firestore.collection('unclaimedAgents').doc(newTwilioNumber).set({
                                            personalPhoneNumber: callerNumber,
                                            agentPhoneConfig: newConfig,
                                            createdAt: new Date().toISOString()
                                        });
                                        console.log(`[WS-Setup] Saved new config to unclaimedAgents for ${callerNumber}`);
                                    }

                                    // If follow-up SMS is configured, send a sample to the owner now
                                    if (args.followUpSms && callerNumber) {
                                        const sampleMsg = `Freshfront: Here is a sample of the follow-up text your leads will receive:\n\n"${args.followUpSms}"`;
                                        sendSms(callerNumber, newTwilioNumber, sampleMsg).catch(e => console.error('[WS-Setup] Sample SMS error:', e));
                                    }

                                    anyToolCalled = true;
                                    session.contents.push({
                                        role: 'user',
                                        parts: [{
                                            functionResponse: {
                                                name: 'provisionAgent',
                                                response: { 
                                                    success: true, 
                                                    newNumber: newTwilioNumber,
                                                    status: userRef ? "Assigned to existing account" : "Created temporarily. User should sign up with their phone number to claim."
                                                }
                                            }
                                        }]
                                    });

                                } catch (provErr: any) {
                                    console.error("[WS-Setup] Error provisioning agent:", provErr);
                                    session.contents.push({
                                        role: 'user',
                                        parts: [{
                                            functionResponse: {
                                                name: 'provisionAgent',
                                                response: { success: false, error: provErr.message || "Failed to provision number." }
                                            }
                                        }]
                                    });
                                }
                            }
                        }
                    }

                    // If any tool was called, we need to call Gemini again to get the final spoken response
                    if (anyToolCalled) {
                        const followup = await ai.models.generateContent({
                            model: 'gemini-2.0-flash',
                            contents: session.contents,
                            config: {
                                systemInstruction: session.systemPrompt,
                                tools: [voiceSetupTools]
                            }
                        });

                        if (followup.candidates?.[0]?.content) {
                            session.contents.push(followup.candidates[0].content);
                            const textPart = followup.candidates[0].content.parts.find((p: any) => p.text);
                            if (textPart?.text) {
                                responseText += " " + textPart.text;
                            }
                        }
                    }

                    wsSetup.send(JSON.stringify({
                        type: 'text',
                        token: responseText.trim(),
                        last: true
                    }));

                    console.log(`[WS-Setup] Gemini (${callSid}): ${responseText}`);
                } catch (apiError) {
                    console.error(`[WS-Setup] Gemini API Error for ${callSid}:`, apiError);
                }
            }
        } catch (e) {
            console.error('[WS-Setup] Error:', e);
        }
    });

    wsSetup.on('close', () => {
        if (callSid && sessions[callSid]) {
            delete sessions[callSid];
        }
    });
});

// ─── Projects Mode WebSocket (/ws-projects) ──────────────────────────────────
wssProjects.on('connection', (wsProjects: WebSocket) => {
    let callSid: string | null = null;
    let callerNumber: string = '';
    let callerUid: string = '';
    let callerName: string = 'there';
    // Cache project names/IDs for this session
    let projectsCache: Array<{ id: string; name: string }> = [];

    wsProjects.on('message', async (message: string) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'setup') {
                callSid = data.callSid;
                const to = data.customParameters?.to || '';
                callerNumber = data.customParameters?.from || '';

                console.log(`[WS-Projects] Setup for call: ${callSid} (From: ${callerNumber})`);

                const firestore = initFirebase();
                let projectListContext = 'You have no projects yet.';

                if (firestore) {
                    try {
                        const normalizedFrom = normalizePhoneNumber(callerNumber);
                        const noPlusFrom = normalizedFrom.startsWith('+') ? normalizedFrom.substring(1) : normalizedFrom;
                        const searchValues = [...new Set([callerNumber, normalizedFrom, noPlusFrom, `+${noPlusFrom}`])].slice(0, 4);
                        const userSnap = await firestore.collection('users')
                            .where('personalPhoneNumber', 'in', searchValues).limit(1).get();

                        if (!userSnap.empty) {
                            const userDoc = userSnap.docs[0];
                            callerUid = userDoc.id;
                            const userData = userDoc.data();
                            callerName = userData.displayName || userData.firstName || 'there';

                            // Load user's projects
                            const projectsSnap = await firestore.collection('users').doc(callerUid)
                                .collection('projects').orderBy('lastModified', 'desc').limit(15).get();

                            projectsCache = projectsSnap.docs.map(d => ({ id: d.id, name: d.data().name || 'Untitled' }));

                            projectListContext = projectsCache.length > 0
                                ? projectsCache.map((p, i) => `${i + 1}. "${p.name}" (ID: ${p.id})`).join('\n')
                                : 'You have no projects yet.';

                            console.log(`[WS-Projects] Loaded ${projectsCache.length} projects for user ${callerUid}`);
                        } else {
                            console.warn(`[WS-Projects] No linked account found for ${callerNumber}`);
                        }
                    } catch (e) {
                        console.error('[WS-Projects] Firestore error during setup:', e);
                    }
                }

                const systemPrompt = `You are a Freshfront voice project assistant. The user's name is ${callerName}.
You help them manage their projects hands-free via a phone call.

CRITICAL VOICE RULES:
- You are on a phone call. Be concise, natural and conversational.
- Never use markdown syntax (asterisks, bullet points, hash symbols).
- Always confirm clearly after performing any action.
- When the user asks to add something, confirm which project they mean if ambiguous.
- Project IDs should NEVER be read aloud. Only refer to projects by name.

CURRENT DATE: ${new Date().toDateString()}

USER'S PROJECTS:
${projectListContext}

CAPABILITIES:
- Create a new project (call createProject)
- Add a note to a project (call addNote)
- Add a task to a project (call addTask)
- Add a calendar event to a project (call addCalendarEvent)
- Generate an AI image for a project (call generateImage)
- List their current projects (call listProjects)

When calling addTask, the priority MUST be one of: low, medium, high.
After each successful action, confirm it was saved and mention that an SMS confirmation was sent.`;

                sessions[callSid!] = { contents: [], systemPrompt, uid: callerUid };

            } else if (data.type === 'prompt') {
                if (!callSid || !sessions[callSid]) return;

                const userPrompt = data.voicePrompt || data.textPrompt;
                const session = sessions[callSid];
                console.log(`[WS-Projects] User (${callSid}): ${userPrompt}`);

                session.contents.push({ role: 'user', parts: [{ text: userPrompt }] });

                try {
                    const firestore = initFirebase();
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: session.contents,
                        config: {
                            systemInstruction: session.systemPrompt,
                            tools: callerUid ? [projectManagementTools] : []
                        }
                    });

                    if (response.candidates?.[0]?.content) {
                        session.contents.push(response.candidates[0].content);
                    }

                    let responseText = '';
                    const parts = response.candidates?.[0]?.content?.parts || [];

                    for (const part of parts) {
                        if (part.text) responseText += part.text;

                        if (part.functionCall && firestore && callerUid) {
                            const call = part.functionCall;
                            let toolResult: any = { success: false };
                            let smsBody = '';

                            try {
                                if (call.name === 'listProjects') {
                                    const snap = await firestore.collection('users').doc(callerUid)
                                        .collection('projects').orderBy('lastModified', 'desc').limit(15).get();
                                    projectsCache = snap.docs.map(d => ({ id: d.id, name: d.data().name || 'Untitled' }));
                                    const list = projectsCache.map((p, i) => `${i + 1}. ${p.name}`).join(', ');
                                    toolResult = { success: true, projects: projectsCache.map(p => p.name), summary: list };

                                } else if (call.name === 'createProject') {
                                    const { name, description } = call.args as any;
                                    const now = Date.now();
                                    const newId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
                                    const newProject = {
                                        id: newId, name, description: description || '', createdAt: now,
                                        lastModified: now, researchSessions: [], draftResearchSessions: [],
                                        tasks: [], notes: [], knowledgeBase: [], aiInsights: [],
                                        projectConversations: [], newsArticles: [], pinnedAssetIds: [],
                                        ownerUid: callerUid
                                    };
                                    await firestore.collection('users').doc(callerUid)
                                        .collection('projects').doc(newId).set(newProject);
                                    projectsCache.unshift({ id: newId, name });
                                    toolResult = { success: true, projectId: newId, name };
                                    smsBody = `✅ Project created: "${name}"\nView it at freshfront.co/projects`;

                                } else if (call.name === 'addNote') {
                                    const { projectId, title, content } = call.args as any;
                                    const projectName = projectsCache.find(p => p.id === projectId)?.name || projectId;
                                    const noteId = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                                    const note = {
                                        id: noteId, title, content, color: null, pinned: false,
                                        aiGenerated: false, aiSuggestions: [], tags: [],
                                        linkedResearchId: null, createdAt: Date.now(), lastModified: Date.now()
                                    };
                                    await firestore.collection('users').doc(callerUid)
                                        .collection('projects').doc(projectId)
                                        .update({ notes: (await import('firebase-admin/firestore')).FieldValue.arrayUnion(note) });
                                    toolResult = { success: true, noteId, projectId };
                                    smsBody = `📝 Note added to "${projectName}":\n"${title}" — ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}`;

                                } else if (call.name === 'addTask') {
                                    const { projectId, title, description: desc, priority } = call.args as any;
                                    const projectName = projectsCache.find(p => p.id === projectId)?.name || projectId;
                                    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                                    const task = {
                                        id: taskId, title, description: desc || '', status: 'todo',
                                        priority: (['low', 'medium', 'high'].includes(priority) ? priority : 'medium'),
                                        order: 0, createdAt: Date.now(), lastModified: Date.now(),
                                        aiGenerated: false, tags: []
                                    };
                                    await firestore.collection('users').doc(callerUid)
                                        .collection('projects').doc(projectId)
                                        .update({ tasks: (await import('firebase-admin/firestore')).FieldValue.arrayUnion(task) });
                                    toolResult = { success: true, taskId, projectId };
                                    smsBody = `✅ Task added to "${projectName}":\n"${title}" (${task.priority} priority)`;

                                } else if (call.name === 'addCalendarEvent') {
                                    const { projectId, title, date, description: desc } = call.args as any;
                                    const projectName = projectsCache.find(p => p.id === projectId)?.name || projectId;
                                    const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                                    // Parse date string to timestamp (best-effort)
                                    let dateTs: number;
                                    try { dateTs = new Date(date).getTime() || Date.now(); } catch { dateTs = Date.now(); }
                                    const event = {
                                        id: eventId, title, date: dateTs, description: desc || '',
                                        createdAt: Date.now(), source: 'voice'
                                    };
                                    await firestore.collection('users').doc(callerUid)
                                        .collection('projects').doc(projectId)
                                        .update({ calendarEvents: (await import('firebase-admin/firestore')).FieldValue.arrayUnion(event) });
                                    toolResult = { success: true, eventId, projectId };
                                    const dateStr = new Date(dateTs).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                                    smsBody = `📅 Event added to "${projectName}":\n"${title}" on ${dateStr}`;

                                } else if (call.name === 'generateImage') {
                                    const { projectId, prompt } = call.args as any;
                                    const projectName = projectsCache.find(p => p.id === projectId)?.name || projectId;
                                    // Queue via Gemini image generation (Imagen 3)
                                    try {
                                        const imgResp = await ai.models.generateImages({
                                            model: 'imagen-3.0-generate-002',
                                            prompt,
                                            config: { numberOfImages: 1, aspectRatio: '16:9' }
                                        });
                                        const imgBytes = imgResp.generatedImages?.[0]?.image?.imageBytes;
                                        if (imgBytes) {
                                            // Store as base64 data URI in project's generatedImages array
                                            const dataUri = `data:image/png;base64,${imgBytes}`;
                                            const imageAsset = {
                                                id: `img-${Date.now()}`, prompt, url: dataUri,
                                                createdAt: Date.now(), source: 'voice', type: 'image/png'
                                            };
                                            await firestore.collection('users').doc(callerUid)
                                                .collection('projects').doc(projectId)
                                                .update({ generatedImages: (await import('firebase-admin/firestore')).FieldValue.arrayUnion(imageAsset) });
                                            toolResult = { success: true, projectId, prompt };
                                            smsBody = `🎨 Image generated for "${projectName}"!\nPrompt: "${prompt.substring(0, 60)}${prompt.length > 60 ? '...' : ''}"\nView it in the Assets tab.`;
                                        }
                                    } catch (imgErr) {
                                        console.error('[WS-Projects] Image generation failed:', imgErr);
                                        toolResult = { success: false, error: 'Image generation failed' };
                                    }
                                }
                            } catch (toolErr: any) {
                                console.error(`[WS-Projects] Tool ${call.name} error:`, toolErr);
                                toolResult = { success: false, error: toolErr.message };
                            }

                            // Send SMS confirmation
                            if (smsBody && callerNumber) {
                                const smsFrom = '+16474904049';
                                sendSms(callerNumber, smsFrom, smsBody).catch(e => console.error('[WS-Projects] SMS error:', e));
                            }

                            // Push function result back and get follow-up response
                            session.contents.push({
                                role: 'user',
                                parts: [{ functionResponse: { name: call.name, response: toolResult } }]
                            });

                            const followup = await ai.models.generateContent({
                                model: 'gemini-2.0-flash',
                                contents: session.contents,
                                config: { systemInstruction: session.systemPrompt, tools: [projectManagementTools] }
                            });

                            if (followup.candidates?.[0]?.content) {
                                session.contents.push(followup.candidates[0].content);
                                const txt = followup.candidates[0].content.parts?.find((p: any) => p.text)?.text || '';
                                if (txt) responseText = txt;
                            }
                        }
                    }

                    wsProjects.send(JSON.stringify({ type: 'text', token: responseText || "Done! Is there anything else?", last: true }));
                    console.log(`[WS-Projects] Gemini (${callSid}): ${responseText?.substring(0, 80)}`);

                } catch (apiError) {
                    console.error(`[WS-Projects] Gemini API Error for ${callSid}:`, apiError);
                    wsProjects.send(JSON.stringify({ type: 'text', token: "Sorry, I ran into an issue. Please try again.", last: true }));
                }

            } else if (data.type === 'interrupt') {
                console.log(`[WS-Projects] Interruption for call ${callSid}`);
            }
        } catch (e) {
            console.error('[WS-Projects] Error:', e);
        }
    });

    wsProjects.on('close', () => {
        console.log(`[WS-Projects] Closed for call: ${callSid}`);
        if (callSid && sessions[callSid]) delete sessions[callSid];
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
