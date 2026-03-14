import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as dotenv from 'dotenv';
import { GoogleGenAI, GenerateContentResponse, Type, Schema } from '@google/genai';
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

const GOOGLE_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
    console.error("Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable is not set.");
    process.exit(1);
}

// Initialize Firebase Admin
const firebaseConfig = {
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!firebaseConfig.project_id || !firebaseConfig.client_email || !firebaseConfig.private_key) {
    console.error("Error: Missing Firebase environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).");
    process.exit(1);
}

if (!getApps().length) {
    try {
        initializeApp({
            credential: cert(firebaseConfig as any),
        });
        console.log("Firebase Admin initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize Firebase Admin:", error);
        process.exit(1);
    }
}
const db = getFirestore();

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

// Helper to normalize phone numbers for comparison
function normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    // Keep only digits and the optional leading plus
    const normalized = phone.replace(/[^\d+]/g, '');
    return normalized;
}

// Helper to find user config by phone number
async function getUserConfig(phoneNumber: string): Promise<any> {
    if (!phoneNumber) return null;
    const normalizedTarget = normalizePhoneNumber(phoneNumber);
    const noPlusTarget = normalizedTarget.startsWith('+') ? normalizedTarget.substring(1) : normalizedTarget;

    try {
        const usersRef = db.collection('users');

        // Twilio numbers are typically stored directly in E.164 format (e.g., +15555555555)
        // Perform a fast, direct database query instead of scanning all users
        const searchValues = [
            phoneNumber,
            normalizedTarget,
            noPlusTarget,
            `+${noPlusTarget}`
        ];

        // Remove duplicates and only keep up to 10 (Firestore 'in' limit)
        const uniqueValues = [...new Set(searchValues)].slice(0, 10);

        const snapshot = await usersRef.where('agentPhoneNumber', 'in', uniqueValues).limit(1).get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            return { uid: doc.id, ...doc.data() };
        }

        // Extremely rare fallback (if a user manually entered a weird format like +1 (555) 555-5555 in the UI)
        console.warn(`[Config] Direct lookup missed for ${phoneNumber}. Falling back to full scan (slow).`);
        const allUsers = await usersRef.where('agentPhoneNumber', '>', '').get();
        for (const doc of allUsers.docs) {
            const data = doc.data();
            if (data.agentPhoneNumber) {
                const userPhone = normalizePhoneNumber(data.agentPhoneNumber);
                const userNoPlus = userPhone.startsWith('+') ? userPhone.substring(1) : userPhone;
                if (userPhone === normalizedTarget || userNoPlus === noPlusTarget) {
                    return { uid: doc.id, ...data };
                }
            }
        }

    } catch (err) {
        console.error("[Config] Firestore Lookup Error:", err);
    }
    return null;
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/twiml') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const postData = querystring.parse(body);
            const to = postData.To as string || '';
            const from = postData.From as string || '';

            console.log(`[Twiml] Incoming call to ${to} from ${from}`);

            // Fetch dynamic user config
            const userData = await getUserConfig(to);
            let welcomeGreeting = WELCOME_GREETING;
            let voice = 'en-US-Journey-F'; // Default female-leaning high quality voice
            let ttsProvider = 'Google';

            if (userData?.agentPhoneConfig?.enabled) {
                if (userData.agentPhoneConfig.welcomeGreeting) {
                    welcomeGreeting = userData.agentPhoneConfig.welcomeGreeting;
                }

                // Map gender/voice preference
                if (userData.agentPhoneConfig.voiceGender === 'male') {
                    voice = 'en-US-Journey-D'; // Standard high quality male
                } else if (userData.agentPhoneConfig.voiceGender === 'female') {
                    voice = 'en-US-Journey-F';
                }
            }

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <ConversationRelay 
            url="${WS_URL}" 
            welcomeGreeting="${welcomeGreeting}"
            ttsProvider="${ttsProvider}"
            voice="${voice}"
        >
            <Parameter name="to" value="${to}" />
            <Parameter name="from" value="${from}" />
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

// Create WebSocket Server attached to HTTP Server
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

                // Lookup user by phone number
                const userData = await getUserConfig(to);
                if (userData) {
                    uid = userData.uid;
                    const config = userData.agentPhoneConfig;

                    if (config?.enabled) {
                        let customInstructions = config.systemPrompt || '';
                        let projectListContext = '';

                        if (config.leadCaptureEnabled) {
                            // Lead Capture Mode: Restrict to custom instructions and lead fields
                            if (config.leadFields?.length > 0) {
                                const fields = config.leadFields.map((f: any) => `${f.name}${f.required ? ' (required)' : ''}`).join(', ');
                                customInstructions += `\n\nLEAD CAPTURE TASK: Your primary goal is to politely collect the following information from the caller: ${fields}. 
                                Once you have collected the required information, acknowledge it and call the 'saveCapturedLead' tool to save the data. 
                                Be natural and conversational while asking for these details. 
                                DO NOT share any internal project data or user information with the caller.`;
                            }
                            console.log(`[WS] Lead Capture mode for user ${uid}. Restricting context.`);
                        } else {
                            // Normal Assistant Mode: Add project context
                            console.log(`[WS] Normal assistant mode for user ${uid}. Injecting project context.`);
                            const projectsSnapshot = await db.collection('users').doc(uid).collection('projects')
                                .orderBy('lastModified', 'desc').limit(10).get();

                            const projectList = projectsSnapshot.docs.map(d => {
                                const data = d.data();
                                return `"${data.name}" (ID: ${d.id})${data.description ? ` - ${data.description.substring(0, 50)}` : ''}`;
                            });

                            if (projectList.length > 0) {
                                projectListContext = `\n\nUSER'S PROJECTS:\n${projectList.join('\n')}`;
                            } else {
                                projectListContext = `\n\nUSER'S PROJECTS: The user has no projects yet.`;
                            }

                            // Add user profile info
                            const userProfileInfo = `\n\nUSER PROFILE: ${userData.displayName || 'Unnamed User'}${userData.description ? ` - ${userData.description}` : ''}`;
                            projectListContext = userProfileInfo + projectListContext;
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

                // Initialize session structure
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
                    const config = sessions[callSid].uid ? (await getUserConfig(callerNumber))?.agentPhoneConfig : null;
                    const leadCaptureEnabled = !!config?.leadCaptureEnabled;

                    const response = await ai.models.generateContent({
                        model: 'gemini-3-flash-preview',
                        contents: session.contents,
                        config: {
                            systemInstruction: session.systemPrompt,
                            tools: leadCaptureEnabled ? [leadCaptureTool] : [] // Voice agent currently only has leadCaptureTool
                        }
                    });

                    // Update contents with model response
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
                                if (session.uid) {
                                    try {
                                        await db.collection('users').doc(session.uid).collection('phoneAgentLeads').add({
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

                                // Send tool response back to Gemini to continue conversation
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
                                    model: 'gemini-3-flash-preview',
                                    contents: session.contents,
                                    config: {
                                        systemInstruction: session.systemPrompt,
                                        tools: [leadCaptureTool]
                                    }
                                });

                                if (followup.candidates?.[0]?.content) {
                                    session.contents.push(followup.candidates[0].content);
                                    const textPart = followup.candidates[0].content.parts.find(p => p.text);
                                    if (textPart?.text) {
                                        responseText = textPart.text;
                                    }
                                }
                            }
                        }
                    }

                    // Send response back to Twilio
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Voice Server listening on port ${PORT}`);
    console.log(`WebSocket URL for Twilio: ${WS_URL}`);
});
