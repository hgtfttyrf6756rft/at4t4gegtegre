import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as dotenv from 'dotenv';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import * as querystring from 'querystring';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || '10000', 10);
const DOMAIN = process.env.RENDER_EXTERNAL_HOSTNAME || process.env.NGROK_URL;

if (!DOMAIN) {
    console.warn("Warning: Neither RENDER_EXTERNAL_HOSTNAME nor NGROK_URL is set. The server will use localhost (manual setup required).");
}

const WS_URL = DOMAIN ? `wss://${DOMAIN}/ws` : `ws://localhost:${PORT}/ws`;

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
            const snapshot = await usersRef.where('agentPhoneNumber', 'in', uniqueValues).limit(1).get();

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
const server = http.createServer(async (req, res) => {
    // Health check endpoint — allows Render/UptimeRobot to keep the server awake
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), wsUrl: WS_URL }));
        return;
    }

    // GET /twiml — for health probe / browser test
    if (req.method === 'GET' && req.url === '/twiml') {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Voice server is running.</Say></Response>`);
        return;
    }

    if (req.method === 'POST' && req.url === '/twiml') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const startTime = Date.now();
            const postData = querystring.parse(body);
            const to = postData.To as string || '';
            const from = postData.From as string || '';

            console.log(`[TwiML] Incoming call to ${to} from ${from}`);

            let welcomeGreeting = WELCOME_GREETING;
            let voice = 'en-US-Journey-F';
            const ttsProvider = 'Google';

            try {
                const userData = await getUserConfig(to);
                if (userData?.agentPhoneConfig?.enabled) {
                    if (userData.agentPhoneConfig.welcomeGreeting) {
                        welcomeGreeting = userData.agentPhoneConfig.welcomeGreeting;
                    }
                    // Resolve voice using voiceName (Gemini Chirp3 HD) or voiceGender fallback
                    voice = resolveVoice(userData.agentPhoneConfig);
                    console.log(`[TwiML] Resolved voice: ${voice} (voiceName=${userData.agentPhoneConfig.voiceName}, voiceGender=${userData.agentPhoneConfig.voiceGender})`);
                }
            } catch (e) {
                console.error('[TwiML] Error fetching user config:', e);
            }

            console.log(`[TwiML] Responding in ${Date.now() - startTime}ms`);

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
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
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
    let callSid: string | null = null;
    let callerNumber: string = '';

    ws.on('message', async (message: string) => {
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
                    const config = userData.agentPhoneConfig;

                    if (config?.enabled) {
                        let customInstructions = config.systemPrompt || '';
                        let projectListContext = '';

                        if (config.leadCaptureEnabled) {
                            if (config.leadFields?.length > 0) {
                                const fields = config.leadFields.map((f: any) => `${f.name}${f.required ? ' (required)' : ''}`).join(', ');
                                customInstructions += `\n\nLEAD CAPTURE TASK: Your primary goal is to politely collect the following information from the caller: ${fields}. 
                                Once you have collected the required information, acknowledge it and call the 'saveCapturedLead' tool to save the data. 
                                Be natural and conversational while asking for these details. 
                                DO NOT share any internal project data or user information with the caller.`;
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
                    const config = (session.uid && firestore) ? (await getUserConfig(callerNumber))?.agentPhoneConfig : null;
                    const leadCaptureEnabled = !!config?.leadCaptureEnabled;

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
                            }
                        }
                    }

                    ws.send(JSON.stringify({
                        type: 'text',
                        token: responseText,
                        last: true
                    }));

                    console.log(`[WS] Gemini (${callSid}): ${responseText}`);
                } catch (apiError) {
                    console.error(`[WS] Gemini API Error for ${callSid}:`, apiError);
                    ws.send(JSON.stringify({
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

    ws.on('close', () => {
        console.log(`[WS] Closed for call: ${callSid}`);
        if (callSid && sessions[callSid]) {
            delete sessions[callSid];
        }
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
