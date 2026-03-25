/**
 * api/agent.ts
 *
 * Consolidated endpoint for all AI Agent, GitHub, Gemini, and Research operations.
 * Merges logic from api/gemini.ts, api/research.ts, and api/assistant-studio.ts.
 */

import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import * as agentService from '../services/agentService.js';
import * as phoneAgentService from '../services/phoneAgentService.js';
import { GoogleGenAI } from '@google/genai';

// ── Legacy Research Modules ───────────────────────────────────────────────────
import * as deepResearch from '../api-legacy/deep-research.js';
import * as newsSearch from '../api-legacy/news-search.js';
import * as braveSearch from '../api-legacy/brave-search.js';
import * as wizaCompanyEnrichTable from '../api-legacy/wiza-company-enrich-table.js';
import * as wizaGenerateTable from '../api-legacy/wiza-generate-table.js';
import * as wizaProspectSearch from '../api-legacy/wiza-prospect-search.js';
import * as computerUse from '../api-legacy/computer-use.js';
import * as computerUseV2 from '../api-legacy/computer-use-v2.js';

type LegacyModule = {
    default?: { fetch?: (request: Request) => Promise<Response> | Response } | ((request: Request) => Promise<Response> | Response);
    fetch?: (request: Request) => Promise<Response> | Response;
    GET?: (request: Request) => Promise<Response> | Response;
    POST?: (request: Request) => Promise<Response> | Response;
};

const LEGACY_ALLOWED: Record<string, LegacyModule> = {
    'deep-research': deepResearch,
    'news-search': newsSearch,
    'brave-search': braveSearch,
    'wiza-company-enrich-table': wizaCompanyEnrichTable,
    'wiza-generate-table': wizaGenerateTable,
    'wiza-prospect-search': wizaProspectSearch,
    'computer-use': computerUse,
    'computer-use-v2': computerUseV2,
};

const callLegacyModule = async (mod: LegacyModule, request: Request): Promise<Response> => {
    const handler =
        (mod?.default as any)?.fetch ||
        (typeof mod?.default === 'function' ? (mod.default as any) : null) ||
        mod?.fetch ||
        (request.method === 'GET' ? mod?.GET : null) ||
        (request.method === 'POST' ? mod?.POST : null);
    if (typeof handler !== 'function') throw new Error('Legacy handler missing');
    return await handler(request);
};



const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (msg: string, status = 400) => json({ error: msg }, status);

const normalizeToE164 = (phone: string): string => {
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
};

// ─── System prompt for the plugin generator (from assistant-studio.ts) ───────
const buildSystemPrompt = (slot: string, relevantDocs: string) => `
You are an AI assistant that writes React plugin components for the "Assistant Studio" feature.

## Your Job
Generate a single, self-contained React component for the "${slot}" slot in the user's AI assistant.

## Rules
1. Export a default React component. Example:
   \`\`\`jsx
   const MyPlugin = ({ project, isDarkMode, apiKeys }) => {
     const [data, setData] = React.useState(null);
     // ...
     return <div>...</div>;
   };
   export default MyPlugin;
   \`\`\`
2. Available scope variables (DO NOT import these):
   - \`React\`, \`useState\`, \`useEffect\`, \`useCallback\` — React core
   - \`storageService\` — internal service for project CRUD
   - \`fetch\` — standard browser fetch for any external APIs
   - \`project\` — the current ResearchProject object
3. For external libraries NOT in scope, use dynamic import:
   \`\`\`js
   const { default: _ } = await import('https://esm.sh/lodash');
   \`\`\`
4. For API calls, use fetch() directly with user's apiKey from apiKeys object.
5. Tailwind CSS classes are available for styling.
6. For icons, use standard SVG elements. Do not import any icon libraries.
7. Do NOT use TypeScript syntax — write plain JSX.
8. Return ONLY the code, no markdown fences or explanation.

## Available API Documentation
${relevantDocs || 'No specific API docs available. Use fetch() for any REST APIs.'}

## Slot: ${slot}
${slot === 'header-actions' ? 'This renders in the assistant header. Keep it compact (small buttons/badges).' : ''}
${slot === 'input-toolbar' ? 'This renders above the message input. Keep it compact.' : ''}
${slot === 'message-footer' ? 'This renders below each AI message in the chat.' : ''}
${slot === 'side-panel' ? 'This renders in a collapsible side panel. Can be more complex/larger UI.' : ''}
`;


export default {
    async fetch(request: Request, env?: any, ctx?: any): Promise<Response> {
        const url = new URL(request.url, 'http://localhost');
        const op = url.searchParams.get('op') || '';

        const adminToken = process.env.AGENT_ADMIN_TOKEN;
        const providedToken = url.searchParams.get('token') || request.headers.get('X-Agent-Admin-Token');
        const isAdmin = adminToken && providedToken === adminToken;

        // Simple ping for connectivity check
        if (op === 'ping') {
            if (!isAdmin) return error('Unauthorized', 401);
            return json({ status: 'alive', time: new Date().toISOString() });
        }

        // ── Gemini Generate (merged from api/gemini.ts) ───────────────────────
        if (op === 'generate') {
            if (request.method !== 'POST') return error('Method not allowed', 405);
            try {
                const body = await request.json();
                const { model, contents, config: genConfig } = body;
                if (!contents) return error('Missing contents');
                const modelName = model || 'gemini-3.1-flash-lite-preview';
                const genaiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY });
                const response = await genaiClient.models.generateContent({ model: modelName, contents, config: genConfig });
                return json({ text: response.text, candidates: response.candidates, promptFeedback: response.promptFeedback });
            } catch (e: any) {
                console.error('Gemini generate failed:', e);
                return error(e.message || 'Gemini API failed', 500);
            }
        }

        // ── Twilio Phone Verification (merged from api/verify.ts) ──────────────
        if (op === 'verify-send' || op === 'verify-check') {
            if (request.method !== 'POST') return error('Method not allowed', 405);
            try {
                const body = await request.json().catch(() => ({}));
                let phoneNumber = body.phoneNumber;
                if (!phoneNumber) return error('Missing phoneNumber');

                // Normalize to E.164 for Twilio Verify
                phoneNumber = normalizeToE164(phoneNumber);
                if (!phoneNumber || phoneNumber.length < 8) return error('Invalid phone number format. Please include country code or use 10-digit US format.');

                const authHeader = request.headers.get('Authorization');
                if (!authHeader?.startsWith('Bearer ')) return error('Unauthorized', 401);
                const token = authHeader.split('Bearer ')[1];
                let uid = '';
                try {
                    const decoded = await getAuth(agentService.adminApp()).verifyIdToken(token);
                    uid = decoded.uid;
                } catch {
                    return error('Invalid token', 401);
                }

                const accountSid = process.env.TWILIO_ACCOUNT_SID;
                const authToken = process.env.TWILIO_AUTH_TOKEN;
                if (!accountSid || !authToken) throw new Error("Missing Twilio credentials");

                const authStr = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
                const serviceSid = await phoneAgentService.getOrCreateVerifyService('FreshFront Verify');

                if (op === 'verify-send') {
                    const reqBody = new URLSearchParams();
                    reqBody.append('To', phoneNumber);
                    reqBody.append('Channel', 'sms');

                    console.log(`[verify-send] Sending to ${phoneNumber} via service ${serviceSid}`);
                    const res = await fetch(`https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Basic ${authStr}`,
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: reqBody.toString()
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        console.error('[verify-send] Twilio Error:', data);
                        const db = getFirestore(agentService.adminApp());
                        await db.collection('agentLogs').add({
                            type: 'twilio-verify-send-error',
                            phoneNumber,
                            error: data.message,
                            data,
                            timestamp: Date.now()
                        });
                        throw new Error(data.message || 'Twilio Verify API Error');
                    }
                    
                    console.log(`[verify-send] Success: status=${data.status}, sid=${data.sid}`);
                    const db = getFirestore(agentService.adminApp());
                    await db.collection('agentLogs').add({
                        type: 'twilio-verify-send',
                        phoneNumber,
                        status: data.status,
                        twilioSid: data.sid,
                        serviceSid,
                        timestamp: Date.now()
                    });
                    return json({ success: true, status: data.status });
                }

                if (op === 'verify-check') {
                    const code = (body.code || '').trim();
                    if (!code) return error('Missing verification code');

                    const reqBody = new URLSearchParams();
                    reqBody.append('To', phoneNumber);
                    reqBody.append('Code', code);

                    console.log(`[verify-check] Checking code for ${phoneNumber} via service ${serviceSid}`);
                    const res = await fetch(`https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Basic ${authStr}`,
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: reqBody.toString()
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        console.error('[verify-check] Twilio Error:', data);
                        const db = getFirestore(agentService.adminApp());
                        await db.collection('agentLogs').add({
                            type: 'twilio-verify-check-error',
                            phoneNumber,
                            error: data.message,
                            data,
                            timestamp: Date.now()
                        });
                        throw new Error(data.message || 'Twilio Verify API Error');
                    }

                    console.log(`[verify-check] Success: status=${data.status}`);
                    const db = getFirestore(agentService.adminApp());
                    await db.collection('agentLogs').add({
                        type: 'twilio-verify-check',
                        phoneNumber,
                        status: data.status,
                        timestamp: Date.now()
                    });

                    if (data.status === 'approved') {
                        const db = getFirestore(agentService.adminApp());
                        const userRef = db.collection('users').doc(uid);
                        await userRef.update({ personalPhoneNumber: phoneNumber });

                        // Robustly search for unclaimed agents using variations to handle legacy non-normalized data
                        const noPlus = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
                        const tenDigits = noPlus.length === 11 && noPlus.startsWith('1') ? noPlus.substring(1) : noPlus;
                        const searchValues = [...new Set([phoneNumber, noPlus, tenDigits])];
                        
                        const unclaimedSnap = await db.collection('unclaimedAgents').where('personalPhoneNumber', 'in', searchValues).get();
                        let claimedCount = 0;
                        
                        if (!unclaimedSnap.empty) {
                            const userSnap = await userRef.get();
                            const userData = userSnap.data() || {};
                            const newList = [...(userData.agentPhoneNumbersList || [])];
                            const allConfigs = { ...(userData.agentPhoneConfigs || {}) };

                            for (const doc of unclaimedSnap.docs) {
                                const twilioNumber = doc.id;
                                const docData = doc.data();
                                if (!newList.includes(twilioNumber)) newList.push(twilioNumber);
                                allConfigs[twilioNumber] = docData.agentPhoneConfig || docData.config;
                                await doc.ref.delete();
                                claimedCount++;
                            }

                            await userRef.update({
                                agentPhoneNumbersList: newList,
                                agentPhoneConfigs: allConfigs
                            });
                        }
                        
                        return json({ success: true, status: 'approved', claimedCount });
                    } else {
                        return json({ success: false, status: data.status });
                    }
                }
            } catch (e: any) {
                console.error('[Verify API]', e);
                return error(e.message, 500);
            }
        }

        // ── Claim Agents ────────────────────────────────────────────────────────
        if (op === 'claim-agents') {
            const authHeader = request.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) return error('Unauthorized', 401);
            const token = authHeader.split('Bearer ')[1];
            
            try {
                const decoded = await getAuth(agentService.adminApp()).verifyIdToken(token);
                const uid = decoded.uid;
                const db = getFirestore(agentService.adminApp());
                const userSnap = await db.collection('users').doc(uid).get();
                const userData = userSnap.data();
                
                if (!userData?.personalPhoneNumber) return error('Phone number not verified', 400);
                
                const phoneNumber = userData.personalPhoneNumber;
                const noPlus = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
                const tenDigits = noPlus.length === 11 && noPlus.startsWith('1') ? noPlus.substring(1) : noPlus;
                const searchValues = [...new Set([phoneNumber, noPlus, tenDigits])];
                
                const unclaimedSnap = await db.collection('unclaimedAgents').where('personalPhoneNumber', 'in', searchValues).get();
                let claimedCount = 0;
                
                if (!unclaimedSnap.empty) {
                    const userRef = db.collection('users').doc(uid);
                    const newList = [...(userData.agentPhoneNumbersList || [])];
                    const allConfigs = { ...(userData.agentPhoneConfigs || {}) };

                    for (const doc of unclaimedSnap.docs) {
                        const twilioNumber = doc.id;
                        const docData = doc.data();
                        if (!newList.includes(twilioNumber)) newList.push(twilioNumber);
                        allConfigs[twilioNumber] = docData.agentPhoneConfig || docData.config;
                        await doc.ref.delete();
                        claimedCount++;
                    }

                    await userRef.update({
                        agentPhoneNumbersList: newList,
                        agentPhoneConfigs: allConfigs
                    });
                }
                
                return json({ success: true, claimedCount });
            } catch (e: any) {
                console.error('[claim-agents]', e);
                return error(e.message, 500);
            }
        }

        // ── Gemini Chat (merged from api/gemini.ts) ───────────────────────────
        if (op === 'chat') {
            if (request.method !== 'POST') return error('Method not allowed', 405);
            try {
                const body = await request.json();
                const { messages, model } = body;
                if (!messages || !Array.isArray(messages) || messages.length === 0) return error('Missing or invalid messages');
                const lastMessage = messages[messages.length - 1];
                const prompt = lastMessage.content;
                if (!prompt) return error('Empty prompt');
                const modelName = model || 'gemini-3.1-flash-lite-preview';
                const genaiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY });
                const response = await genaiClient.models.generateContent({ model: modelName, contents: prompt });
                return json({ response: response.text });
            } catch (e: any) {
                console.error('Gemini chat failed:', e);
                return error(e.message || 'Gemini API failed', 500);
            }
        }

        // ── Legacy Research Proxy (merged from api/research.ts) ───────────────
        if (LEGACY_ALLOWED[op]) {
            try {
                return await callLegacyModule(LEGACY_ALLOWED[op], request);
            } catch (e: any) {
                return error(e?.message || 'Internal error', 500);
            }
        }

        // Public/Semi-public ops
        if (op === 'deploy-status') {

            const deploymentId = url.searchParams.get('deploymentId');
            if (!deploymentId) return error('Missing deploymentId');
            const status = await agentService.getDeploymentStatus(deploymentId);
            return json(status);
        }

        const origin = url.origin;
        const redirectUri = process.env.GITHUB_CALLBACK_URL || `${origin}/api/agent?op=github-callback`;

        if (op === 'github-authorize') {
            const state = crypto.randomUUID();
            const authUrl = agentService.getGitHubAuthUrl(state, redirectUri);
            console.log(`[github-authorize] Redirecting via 302 to: ${authUrl}`);

            return new Response(null, {
                status: 302,
                headers: {
                    'Location': authUrl,
                    'Set-Cookie': `gh_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
                },
            });
        }

        if (op === 'github-callback') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');

            const cookies = request.headers.get('Cookie') || '';
            const stateCookie = cookies.split(';').find(c => c.trim().startsWith('gh_state='))?.split('=')[1];

            if (!state || state !== stateCookie) {
                return new Response('<html><body><script>window.opener?.postMessage({type:"github:error",error:"Invalid state"}, "*"); window.close();</script></body></html>', { headers: { 'Content-Type': 'text/html' } });
            }

            if (!code) return new Response('<html><body><script>window.opener?.postMessage({type:"github:error",error:"No code"}, "*"); window.close();</script></body></html>', { headers: { 'Content-Type': 'text/html' } });
            try {
                const { token, username } = await agentService.exchangeGitHubCode(code, redirectUri);
                return new Response(`<html><body><script>window.opener?.postMessage({type:"github:connected",token:"${token}",username:"${username}"}, "*"); window.close();</script></body></html>`, { headers: { 'Content-Type': 'text/html' } });
            } catch (e: any) {
                return new Response(`<html><body><script>window.opener?.postMessage({type:"github:error",error:"${e.message}"}, "*"); window.close();</script></body></html>`, { headers: { 'Content-Type': 'text/html' } });
            }
        }

        if (op === 'view-logs') {
            // Temporarily allow access for debugging
            // if (!isAdmin) return error('Unauthorized', 401);
            try {
                const db = getFirestore(agentService.adminApp());
                const snapshot = await db.collection('agentLogs').orderBy('timestamp', 'desc').limit(20).get();
                const logs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                return json(logs);
            } catch (e: any) {
                return error(e.message, 500);
            }
        }

        if (op === 'test-webhook') {
            if (!isAdmin) return error('Unauthorized', 401);
            const from = url.searchParams.get('from') || '';
            const to = url.searchParams.get('to') || '';
            const bodyStr = url.searchParams.get('body') || 'Hello';

            console.log(`[test-webhook] Testing: From=${from} To=${to} Body="${bodyStr}"`);
            try {
                const result = await phoneAgentService.handleIncomingMessage(from, to, bodyStr, []);
                return json({ success: true, result });
            } catch (e: any) {
                return error(e.message, 500);
            }
        }

        // Webhook handler for Twilio (async pattern to avoid 15s timeout)
        if ((op === 'webhook' || op === '') && request.method === 'POST') {
            const contentType = request.headers.get('Content-Type') || '';

            // 1. Handle Twilio Event Streams and Debugger (JSON)
            if (contentType.includes('application/json')) {
                try {
                    const payload = await request.json() as any;
                    const events = Array.isArray(payload) ? payload : [payload];
                    // Fire-and-forget: log events but don't block the response
                    (async () => {
                        try {
                            const db = getFirestore(agentService.adminApp());
                            for (const event of events) {
                                const type = event.type || event.Level || 'unknown_event';
                                const data = event.data || event.Payload || event;
                                const messageSid = data.messageSid || data.sid || event.Sid || 'unknown';
                                console.log(`[twilio-event] Received: ${type} for ${messageSid}`);
                                await db.collection('agentLogs').add({
                                    type: 'twilio_event', eventType: type, messageSid, data, timestamp: Date.now()
                                });
                            }
                        } catch (e) { console.error('[twilio-event] Firestore log error:', e); }
                    })();
                    return new Response('OK', { status: 200 });
                } catch (e: any) {
                    console.error('[twilio-event] Error parsing event:', e);
                    return error('Invalid JSON', 400);
                }
            }

            // 2. Parse form data for SMS/Voice webhooks
            let formData;
            try {
                formData = await request.formData();
            } catch (e) {
                return new Response('Invalid form data', { status: 400 });
            }

            const from = formData.get('From')?.toString() || '';
            const to = formData.get('To')?.toString() || '';
            const bodyStr = formData.get('Body')?.toString() || '';
            const messageSid = formData.get('MessageSid')?.toString() || 'unknown';
            const callSid = formData.get('CallSid')?.toString();
            const callStatus = formData.get('CallStatus')?.toString();
            const numMedia = parseInt(formData.get('NumMedia')?.toString() || '0', 10);

            // 3. Handle Twilio Error/Alert Webhooks (JSON payload hidden in form data)
            const level = formData.get('Level')?.toString();
            const payloadStr = formData.get('Payload')?.toString();
            
            if (level || payloadStr) {
                try {
                    let errCode = formData.get('ErrorCode')?.toString();
                    let msgBody = formData.get('Msg')?.toString();
                    
                    if (payloadStr) {
                        const parsed = JSON.parse(payloadStr);
                        errCode = errCode || parsed.ErrorCode;
                        msgBody = msgBody || parsed.Msg;
                    }
                    console.log(`[twilio-webhook] Received System/Error Webhook: ${errCode || 'N/A'} - ${msgBody || 'N/A'}`);
                    return new Response('OK', { status: 200 }); // Must return 200 immediately to acknowledge the alert
                } catch (e) {
                    console.error('[twilio-webhook] Failed to parse Error webhook payload', e);
                }
            }

            // 4. IMPORTANT: Detect Voice calls FIRST — before ANY other validation.
            // Twilio Voice webhooks send CallSid + CallStatus but no Body/MessageSid.
            const isVoiceCall = !!callSid && (!!callStatus || !bodyStr);
            
            // Handle completed call follow-up (triggered via Connect action or status callback)
            if (isVoiceCall && (callStatus === 'completed' || formData.get('SessionStatus') === 'completed')) {
                console.log(`[twilio-webhook] Call completed for ${to}. Checking for follow-up SMS...`);
                try {
                    const db = getFirestore(agentService.adminApp());
                    let usersSnap = await db.collection('users').where('agentPhoneNumbersList', 'array-contains', to).limit(1).get();
                    if (usersSnap.empty) {
                        usersSnap = await db.collection('users').where('agentPhoneNumber', '==', to).limit(1).get();
                    }

                    let config: any = null;
                    if (!usersSnap.empty) {
                        const userData = usersSnap.docs[0].data();
                        config = userData.agentPhoneConfigs?.[to] || userData.agentPhoneConfig;
                    } else {
                        const unclaimedSnap = await db.collection('unclaimedAgents').doc(to).get();
                        if (unclaimedSnap.exists) {
                            config = unclaimedSnap.data()?.agentPhoneConfig;
                        }
                    }

                    if (config?.mode === 'leads' && config?.followUpSms) {
                        console.log(`[twilio-webhook] Sending follow-up SMS to ${from}: "${config.followUpSms}"`);
                        await phoneAgentService.sendTwilioSms(from, to, config.followUpSms);
                    }
                } catch (e) {
                    console.error('[twilio-webhook] Follow-up SMS error:', e);
                }
                return new Response('OK', { status: 200 });
            }

            if (isVoiceCall) {
                console.log(`[twilio-webhook] Voice call detected. CallSid=${callSid}, CallStatus=${callStatus}, To=${to}, From=${from}`);
                const voiceServerUrl = (process.env.VOICE_SERVER_URL || '').trim();
                let redirectUrl = voiceServerUrl;
                if (redirectUrl && !redirectUrl.endsWith('/twiml')) {
                    redirectUrl = redirectUrl.replace(/\/+$/, '') + '/twiml';
                }
                const twiml = redirectUrl
                    ? `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Connecting you to your agent, please wait a moment.</Say><Redirect method="POST">${redirectUrl}</Redirect></Response>`
                    : `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Voice agent is not configured. Please set VOICE_SERVER_URL.</Say></Response>`;
                console.log(`[twilio-webhook] Redirecting voice call to: ${redirectUrl || 'N/A'}`);
                return new Response(twiml, { status: 200, headers: { 'Content-Type': 'text/xml' } });
            }

            // 5. SMS/MMS — collect media URLs
            const incomingMediaUrls: string[] = [];
            for (let i = 0; i < numMedia; i++) {
                const mediaUrl = formData.get(`MediaUrl${i}`)?.toString();
                if (mediaUrl) incomingMediaUrls.push(mediaUrl);
            }

            if (!to || (!bodyStr && numMedia === 0)) {
                console.warn(`[twilio-webhook] Missing To or Body/Media (Form Keys: ${Array.from(formData.keys()).join(', ')})`);
                return new Response('Missing To or Body', { status: 400 });
            }

            const db = getFirestore(agentService.adminApp());

            console.log(`[twilio-webhook] Incoming: From=${from} To=${to} MessageSid=${messageSid} Body="${bodyStr}" Media=${numMedia}`);

            // ─── NOTE MODE: Handle SMS to a hotline/note-mode number ─────────────────
            try {
                let usersSnap = await db.collection('users')
                    .where('agentPhoneNumbersList', 'array-contains', to)
                    .limit(1)
                    .get();
                
                if (usersSnap.empty) {
                    usersSnap = await db.collection('users')
                        .where('agentPhoneNumber', '==', to)
                        .limit(1)
                        .get();
                }

                // Check if this number belongs to a linked user
                let isLinkedOwner = false;
                let linkedUid = '';
                let linkedUserRef: any = null;
                let hotlineConfig: any = null;

                if (!usersSnap.empty) {
                    const userData = usersSnap.docs[0].data();
                    const activeConfig = userData.agentPhoneConfigs?.[to] || userData.agentPhoneConfig;

                    if ((activeConfig?.mode === 'note' || activeConfig?.mode === 'notes') && activeConfig?.enabled) {
                        linkedUid = usersSnap.docs[0].id;
                        linkedUserRef = usersSnap.docs[0].ref;
                        hotlineConfig = activeConfig;

                        // Check if sender is the owner (compare personalPhoneNumber)
                        const ownerNum = (userData.personalPhoneNumber || '').replace(/\D/g, '');
                        const senderNum = from.replace(/\D/g, '');
                        isLinkedOwner = ownerNum.length > 0 && (ownerNum === senderNum || ownerNum.endsWith(senderNum) || senderNum.endsWith(ownerNum));
                    }
                }

                // Also check unclaimedAgents for unlinked hotlines
                let isUnlinkedOwner = false;
                let unclaimedRef: any = null;
                let unclaimedData: any = null;

                if (!isLinkedOwner) {
                    try {
                        const unclaimedSnap = await db.collection('unclaimedAgents').doc(to).get();
                        if (unclaimedSnap.exists) {
                            unclaimedData = unclaimedSnap.data();
                            const unclaimedOwnerNum = (unclaimedData?.ownerPhone || unclaimedData?.personalPhoneNumber || '').replace(/\D/g, '');
                            const senderNum = from.replace(/\D/g, '');
                            isUnlinkedOwner = unclaimedOwnerNum.length > 0 && (unclaimedOwnerNum === senderNum || unclaimedOwnerNum.endsWith(senderNum) || senderNum.endsWith(unclaimedOwnerNum));
                            if (isUnlinkedOwner) unclaimedRef = unclaimedSnap.ref;
                        }
                    } catch (e) {
                        console.warn('[twilio-webhook] Could not check unclaimedAgents:', e);
                    }
                }

                const isNoteOwner = isLinkedOwner || isUnlinkedOwner;
                const isNoteMode = hotlineConfig?.enabled || (isUnlinkedOwner && unclaimedData?.agentPhoneConfig?.mode === 'notes');

                if (isNoteMode && isNoteOwner && bodyStr?.trim()) {
                    // ─── Owner text: always training-only, no conversational reply ───
                    if (isLinkedOwner && linkedUserRef) {
                        // Linked owner: save note silently, apply upsell counter too
                        const notesSnap = await db.collection('users').doc(linkedUid).collection('phoneAgentNotes').get();
                        const currentCount = notesSnap.size + 1;

                        await db.collection('users').doc(linkedUid).collection('phoneAgentNotes').add({
                            body: bodyStr,
                            from,
                            timestamp: Date.now()
                        });
                        console.log(`[twilio-webhook] Note Mode: saved training note #${currentCount} from linked owner ${from} for user ${linkedUid}`);

                        if (currentCount === 3) {
                            const upsellMsg = `Note saved! ✨ Tip: your hotline is now learning from your texts. Visit freshfront.co → Profile Settings to manage your hotline and unlock your full dashboard. (Pro plan)`;
                            await phoneAgentService.sendTwilioSms(from, to, upsellMsg);
                        }
                    } else if (isUnlinkedOwner && unclaimedRef) {
                        // ─── Unlinked owner: store note counter and send upsell on 3rd ───
                        const currentCount = (unclaimedData?.ownerNoteCount || 0) + 1;
                        await unclaimedRef.update({ ownerNoteCount: currentCount });

                        await unclaimedRef.collection('notes').add({
                            body: bodyStr,
                            from,
                            timestamp: Date.now()
                        });
                        console.log(`[twilio-webhook] Note Mode: saved note #${currentCount} from unlinked owner ${from}`);

                        if (currentCount >= 3) {
                            const upsellMsg = `You've added ${currentCount} notes to your hotline ✨ Sign up at freshfront.co → Profile Settings → link your phone number to unlock unlimited training and your full dashboard. (Pro plan required)`;
                            await phoneAgentService.sendTwilioSms(from, to, upsellMsg);
                        }
                    }

                    // Always return silent empty TwiML for owner — no reply
                    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`, {
                        status: 200, headers: { 'Content-Type': 'text/xml' }
                    });
                }

                // ─── Non-owner callers in note mode: fall through to regular AI ───
                if (isNoteMode && !isNoteOwner) {
                    // Allow callers to ask questions via SMS too (treated as regular AI query)
                    console.log(`[twilio-webhook] Note Mode: non-owner SMS from ${from} — falling through to AI.`);
                }

                // ─── Legacy trainer-based note mode (existing flow) ───
                if (!isNoteMode && !usersSnap.empty) {
                    const userData = usersSnap.docs[0].data();
                    const activeConfig = userData.agentPhoneConfigs?.[to] || userData.agentPhoneConfig;
                    if ((activeConfig?.mode === 'note' || activeConfig?.mode === 'notes') && activeConfig?.enabled) {
                        const uid = usersSnap.docs[0].id;
                        const trainerStr = activeConfig.trainerNumbers || '';
                        const trainers = trainerStr.split(',').map((n: string) => n.replace(/\D/g, '')).filter(Boolean);
                        const incomingNum = from.replace(/\D/g, '');
                        const isTrainer = trainers.length === 0 || trainers.includes(incomingNum);
                        if (isTrainer && bodyStr?.trim()) {
                            await db.collection('users').doc(uid).collection('phoneAgentNotes').add({
                                body: bodyStr,
                                from,
                                timestamp: Date.now()
                            });
                            console.log(`[twilio-webhook] Legacy Note Mode: saved note from ${from} for user ${uid}`);
                            return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`, {
                                status: 200, headers: { 'Content-Type': 'text/xml' }
                            });
                        }
                    }
                }
            } catch (noteErr) {
                console.error('[twilio-webhook] Note Mode lookup error:', noteErr);
                // Fall through to normal processing
            }


            // Process in background — send result via Twilio REST API
            // This prevents Twilio's 15-second webhook timeout from killing long-running tools
            const processTask = (async () => {

                const logRef = db.collection('agentLogs').doc();
                try {
                    await logRef.set({
                        type: 'webhook_incoming',
                        from, to, body: bodyStr, media: numMedia,
                        messageSid, // Store incoming SID to correlate with events
                        timestamp: Date.now()
                    });

                    console.log(`[twilio-webhook] Starting background processing for ${from}`);
                    const result = await phoneAgentService.handleIncomingMessage(
                        from, to, bodyStr || '(sent an image)', incomingMediaUrls
                    );

                    console.log(`[twilio-webhook] AI result ready for ${from}: "${result.text.substring(0, 50)}..."`);
                    await logRef.update({ aiResponse: result.text, status: 'processed' });

                    // Send the actual response via Twilio REST API
                    const twilioRes = await phoneAgentService.sendTwilioSms(
                        from, to, result.text, result.mediaUrls
                    );

                    // Store the outgoing message SID if available
                    const outgoingSid = (twilioRes as any)?.sid;
                    await logRef.update({ status: 'sent', outgoingSid });
                    console.log(`[twilio-webhook] Async response sent to ${from}, SID: ${outgoingSid}`);
                } catch (e: any) {
                    console.error('[twilio-webhook] Async handler error:', e);
                    await logRef.update({ status: 'error', error: e.message });
                    try {
                        await phoneAgentService.sendTwilioSms(
                            from, to, 'Sorry, I encountered an error processing your request.'
                        );
                    } catch (smsError) {
                        console.error('[twilio-webhook] Failed to send error SMS:', smsError);
                    }
                }
            })();

            // Use waitUntil if available (Vercel/Cloudflare Edge)
            if (ctx?.waitUntil) {
                ctx.waitUntil(processTask);
            } else {
                // If we don't have waitUntil, we MUST be careful.
                // But if we await, we might exceed Twilio's 15s timeout.
                // We'll try to process but if it takes too long, Twilio will timeout and retry.
                // However, without waitUntil, the process might be killed immediately.
                // So we'll await a small portion or just the whole thing if we have to.
                // For now, let's await the whole thing to be safe in Serverless Node.
                await processTask;
            }

            // Return immediate empty TwiML response (no <Message> — we send it async)
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
            return new Response(twiml, {
                status: 200,
                headers: { 'Content-Type': 'text/xml' }
            });
        }

        // Authenticated ops (and public webhooks)
        const authHeader = request.headers.get('Authorization');
        if (!authHeader && request.method === 'POST' && op !== 'github-webhook') return error('Unauthorized', 401);

        let uid = '';
        try {
            const app = agentService.adminApp();
            const decoded = await getAuth(app).verifyIdToken(authHeader!.replace('Bearer ', ''));
            uid = decoded.uid;
        } catch {
            if (request.method === 'POST') return error('Invalid auth token', 401);
        }

        // POST Ops
        if (request.method === 'POST') {
            if (op === 'github-webhook') {
                const signature = request.headers.get('x-hub-signature-256');
                const event = request.headers.get('x-github-event');
                const bodyText = await request.text();

                const secret = process.env.GITHUB_WEBHOOK_SECRET || 'dev_secret';

                // Verify signature
                if (signature) {
                    const hmac = crypto.createHmac('sha256', secret);
                    const digest = 'sha256=' + hmac.update(bodyText).digest('hex');
                    if (digest !== signature) {
                        return new Response('Invalid signature', { status: 401 });
                    }
                }

                if (event === 'ping') {
                    return new Response('pong', { status: 200 });
                }

                if (event === 'push') {
                    const payload = JSON.parse(bodyText);
                    const repoName = payload.repository?.name;
                    const headCommitSha = payload.after || payload.head_commit?.id;

                    if (!repoName || !headCommitSha) {
                        return new Response('Missing repo name or head commit sha', { status: 400 });
                    }

                    // Find the project in Firestore using a collectionGroup query
                    const db = getFirestore(agentService.adminApp());
                    const projectsSnapshot = await db.collectionGroup('projects')
                        .where('githubRepoName', '==', repoName)
                        .limit(1)
                        .get();

                    if (projectsSnapshot.empty) {
                        console.log(`[github-webhook] No project found for repo ${repoName}`);
                        return new Response('Project not found', { status: 200 });
                    }

                    const projectRef = projectsSnapshot.docs[0].ref;
                    await projectRef.update({
                        lastKnownCommitSha: headCommitSha,
                        lastModified: Date.now()
                    });

                    console.log(`[github-webhook] Updated project ${projectRef.id} with new commit ${headCommitSha}`);
                }

                return new Response('OK', { status: 200 });
            }

            const body = await request.json() as any;

            if (op === 'search-numbers') {
                console.log('[agent] search-numbers: areaCode =', body.areaCode);
                try {
                    // 25-second timeout to fail fast instead of waiting 300s
                    const searchPromise = phoneAgentService.searchTwilioNumbers(body.areaCode);
                    const timeoutPromise = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Twilio search timed out after 25s')), 25000)
                    );
                    const numbers = await Promise.race([searchPromise, timeoutPromise]);
                    console.log('[agent] search-numbers: found', (numbers as any[]).length, 'numbers');
                    return json({ numbers });
                } catch (e: any) {
                    console.error('[agent] search-numbers error:', e.message);
                    return error(e.message, 500);
                }
            }

            if (op === 'buy-number') {
                try {
                    const appUrl = (url.origin === 'http://localhost' && process.env.APP_URL) ? process.env.APP_URL : url.origin;
                    const voiceUrl = body.voiceUrl;
                    console.log(`[buy-number] Provisioning ${body.phoneNumber} with appUrl: ${appUrl}, voiceUrl: ${voiceUrl}`);
                    const phoneNumber = await phoneAgentService.buyTwilioNumber(body.phoneNumber, appUrl, voiceUrl);

                    // Auto-assign to user
                    const db = getFirestore(agentService.adminApp());
                    const userRef = db.collection('users').doc(uid);
                    const userSnap = await userRef.get();
                    const userData = userSnap.exists ? userSnap.data() || {} : {};
                    
                    const newList = [...(userData.agentPhoneNumbersList || [])];
                    if (!newList.includes(phoneNumber)) newList.push(phoneNumber);
                    
                    const newConfig = {
                        ...(body.existingConfig || { mode: 'projects' }),
                        enabled: true,
                    };

                    await userRef.set({
                        agentPhoneNumber: phoneNumber, // maintain legacy fallback
                        agentPhoneConfig: newConfig,
                        agentPhoneNumbersList: newList,
                        agentPhoneConfigs: {
                            ...(userData.agentPhoneConfigs || {}),
                            [phoneNumber]: newConfig
                        }
                    }, { merge: true });

                    console.log(`[buy-number] Successfully assigned ${phoneNumber} to user ${uid}`);
                    return json({ success: true, phoneNumber });
                } catch (e: any) {
                    console.error('[buy-number] Error:', e.message);
                    return error(e.message, 500);
                }
            }

            // classify-agent: lightweight, no auth required — runs AI classification server-side
            if (op === 'classify-agent') {
                const agent = await agentService.classifyProjectAgent(body.name || '', body.description || '');
                return json(agent);
            }

            if (op === 'generate-and-deploy' || op === 'redeploy') {
                const { projectId, userPrompt, existingConfig } = body;

                // Return a Server-Sent Events stream so the client gets real-time progress
                const { readable, writable } = new TransformStream();
                const writer = writable.getWriter();
                const enc = new TextEncoder();
                const send = async (event: Record<string, any>) => {
                    await writer.write(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
                };

                // Run pipeline in the background and stream events as they arrive
                agentService.runDeployPipeline({
                    uid, projectId, userPrompt, existingConfig,
                    isRedeploy: op === 'redeploy',
                    onProgress: send,
                    appUrl: url.origin,
                }).catch(async (e: any) => {
                    console.error('[agent] runDeployPipeline error:', e);
                    await send({ type: 'error', message: e?.message || 'Deploy pipeline failed' });
                }).finally(async () => {
                    await writer.close();
                });

                return new Response(readable, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'X-Accel-Buffering': 'no', // Disable Nginx buffering
                    },
                });
            }

            if (op === 'github-store-token') {
                const { token, username } = body;
                const db = getFirestore(agentService.adminApp());
                await db.doc(`users/${uid}`).set({ githubAccessToken: token, githubUsername: username }, { merge: true });
                return json({ success: true });
            }

            if (op === 'transfer') {
                const { projectId } = body;
                const res = await agentService.transferRepoToUser({ uid, projectId });
                return json(res);
            }

            if (op === 'add-domain') {
                const { vercelProjectId, domain } = body;
                if (!vercelProjectId || !domain) return error('Missing vercelProjectId or domain');
                const result = await agentService.addVercelDomain(vercelProjectId, domain);
                return json(result);
            }

            if (op === 'remove-domain') {
                const { vercelProjectId, domain } = body;
                if (!vercelProjectId || !domain) return error('Missing vercelProjectId or domain');
                const result = await agentService.removeVercelDomain(vercelProjectId, domain);
                return json(result);
            }

            if (op === 'verify-domain') {
                const { vercelProjectId, domain } = body;
                if (!vercelProjectId || !domain) return error('Missing vercelProjectId or domain');
                const result = await agentService.verifyVercelDomain(vercelProjectId, domain);
                return json(result);
            }

            if (op === 'revert-commit') {
                const { repoOwner, repoName, targetSha } = body;
                if (!repoOwner || !repoName || !targetSha) return error('Missing repoOwner, repoName, or targetSha');
                const result = await agentService.revertToCommitSha(repoOwner, repoName, targetSha);
                return json(result);
            }

            if (op === 'add-env-var') {
                const { vercelProjectId, key, value, target } = body;
                if (!vercelProjectId || !key || !value) return error('Missing requirements');
                const result = await agentService.createVercelEnvVar(vercelProjectId, key, value, target || ['production', 'preview', 'development']);
                return json(result);
            }

            if (op === 'update-env-var') {
                const { vercelProjectId, envId, value, target } = body;
                if (!vercelProjectId || !envId || !value) return error('Missing requirements');
                const result = await agentService.updateVercelEnvVar(vercelProjectId, envId, value, target || ['production', 'preview', 'development']);
                return json(result);
            }

            if (op === 'remove-env-var') {
                const { vercelProjectId, envId } = body;
                if (!vercelProjectId || !envId) return error('Missing requirements');
                const result = await agentService.removeVercelEnvVar(vercelProjectId, envId);
                return json(result);
            }

            if (op === 'add-custom-env') {
                const { vercelProjectId, slug, type } = body;
                if (!vercelProjectId || !slug) return error('Missing requirements');
                const result = await agentService.createVercelCustomEnv(vercelProjectId, slug, type || 'preview');
                return json(result);
            }

            if (op === 'remove-custom-env') {
                const { vercelProjectId, envId } = body;
                if (!vercelProjectId || !envId) return error('Missing requirements');
                const result = await agentService.removeVercelCustomEnv(vercelProjectId, envId);
                return json(result);
            }

            // ─── Assistant Studio Ops (Consolidated) ──────────────────────────
            if (op === 'generate-plugin') {
                try {
                    const { prompt, slot, currentCode, versionId } = body;
                    if (!prompt?.trim()) return error('prompt is required');
                    if (!slot?.trim()) return error('slot is required');

                    const db = getFirestore(agentService.adminApp());

                    // 1. Fetch relevant API docs
                    const docsSnap = await db.collection('api_docs').get();
                    const allDocs: any[] = docsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

                    // Score docs by keyword relevance
                    const words = prompt.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
                    const relevantDocs = allDocs
                        .map((doc: any) => {
                            const haystack = [doc.api, ...(doc.tags || []), doc.documentation?.slice(0, 500)].join(' ').toLowerCase();
                            const score = words.reduce((acc: number, w: string) => acc + (haystack.includes(w) ? 1 : 0), 0);
                            return { doc, score };
                        })
                        .filter((s: any) => s.score > 0)
                        .sort((a: any, b: any) => b.score - a.score)
                        .slice(0, 3)
                        .map((s: any) => `### ${s.doc.api}\n${s.doc.documentation}`)
                        .join('\n\n---\n\n');

                    // 2. Build AI prompt
                    const systemPrompt = buildSystemPrompt(slot, relevantDocs);
                    const userMessage = currentCode
                        ? `Current plugin code:\n\`\`\`jsx\n${currentCode}\n\`\`\`\n\nUser request: ${prompt}`
                        : `User request: ${prompt}`;

                    // 3. Call Gemini
                    const genaiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                    const response = await genaiClient.models.generateContent({
                        model: 'gemini-1.5-pro',
                        config: { systemInstruction: systemPrompt, temperature: 0.3 },
                        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
                    });

                    let generatedCode = response.text || '';
                    generatedCode = generatedCode
                        .replace(/^```(?:jsx?|tsx?|javascript|typescript)?\n?/i, '')
                        .replace(/\n?```$/i, '')
                        .trim();

                    // 4. Optionally save as draft to Firestore
                    if (versionId) {
                        const versionRef = db.collection('users').doc(uid).collection('assistant_versions').doc(versionId);
                        const vSnap = await versionRef.get();
                        if (vSnap.exists) {
                            const vData = vSnap.data() || {};
                            const plugins = vData.plugins || {};
                            await versionRef.set({
                                plugins: { ...plugins, [slot]: generatedCode },
                                updatedAt: Date.now(),
                            }, { merge: true });
                        }
                    }

                    return json({ code: generatedCode, relevantDocsCount: relevantDocs ? 3 : 0 });
                } catch (e: any) {
                    console.error('[agent] generate-plugin error:', e);
                    return error(e?.message || 'Generation failed', 500);
                }
            }

            if (op === 'save-version') {
                try {
                    const { name, description, projectId, plugins, installedApis, apiKeys, isActive } = body;
                    if (!name || !projectId) return error('name and projectId are required');

                    const db = getFirestore(agentService.adminApp());
                    const versionsCol = db.collection('users').doc(uid).collection('assistant_versions');

                    // If activating, deactivate all others first
                    if (isActive) {
                        const q = await versionsCol.where('projectId', '==', projectId).get();
                        for (const d of q.docs) {
                            await d.ref.set({ isActive: false }, { merge: true });
                        }
                    }

                    const id = body.id || `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    await versionsCol.doc(id).set({
                        id,
                        projectId,
                        name,
                        description: description || '',
                        plugins: plugins || {},
                        installedApis: installedApis || [],
                        apiKeys: apiKeys || {},
                        isActive: isActive ?? false,
                        createdAt: body.createdAt || Date.now(),
                        updatedAt: Date.now(),
                    }, { merge: true });

                    return json({ success: true, id });
                } catch (e: any) {
                    return error(e?.message || 'Save failed', 500);
                }
            }
        }

        // GET Ops
        if (op === 'github-status') {
            if (!uid) return json({ connected: false });
            const userDoc = await getFirestore(agentService.adminApp()).doc(`users/${uid}`).get();
            const data = userDoc.data();
            return json({ connected: !!data?.githubAccessToken, username: data?.githubUsername });
        }

        if (op === 'deployment-check') {
            const vercelProjectId = url.searchParams.get('vercelProjectId');
            if (!vercelProjectId) return error('Missing vercelProjectId');
            const result = await agentService.getLatestDeploymentCheck(vercelProjectId);
            return json(result);
        }

        if (op === 'repo-history') {
            const repoOwner = url.searchParams.get('repoOwner');
            const repoName = url.searchParams.get('repoName');
            if (!repoOwner || !repoName) return error('Missing repoOwner or repoName');
            const commits = await agentService.getRepoCommits(repoOwner, repoName);
            return json({ commits });
        }

        if (op === 'repo-files') {
            const repoOwner = url.searchParams.get('repoOwner');
            const repoName = url.searchParams.get('repoName');
            if (!repoOwner || !repoName) return error('Missing repoOwner or repoName');
            const files = await agentService.getRepoFileTree(repoOwner, repoName);
            return json({ files });
        }

        if (op === 'file-content') {
            const repoOwner = url.searchParams.get('repoOwner');
            const repoName = url.searchParams.get('repoName');
            const filePath = url.searchParams.get('path');
            if (!repoOwner || !repoName || !filePath) return error('Missing repoOwner, repoName, or path');
            const content = await agentService.getFileContent(repoOwner, repoName, filePath);
            if (content === null) return error('File not found', 404);
            return json({ content, path: filePath });
        }

        if (op === 'check-domain') {
            const vercelProjectId = url.searchParams.get('vercelProjectId');
            const domain = url.searchParams.get('domain');
            if (!vercelProjectId || !domain) return error('Missing vercelProjectId or domain');
            const result = await agentService.checkVercelDomainStatus(vercelProjectId, domain);
            return json(result);
        }

        if (op === 'get-env-vars') {
            const vercelProjectId = url.searchParams.get('vercelProjectId');
            if (!vercelProjectId) return error('Missing vercelProjectId');
            const result = await agentService.getVercelEnvVars(vercelProjectId);
            return json(result);
        }

        if (op === 'get-custom-envs') {
            const vercelProjectId = url.searchParams.get('vercelProjectId');
            if (!vercelProjectId) return error('Missing vercelProjectId');
            const result = await agentService.getVercelCustomEnvs(vercelProjectId);
            return json(result);
        }

        if (op === 'get-versions') {
            const projectId = url.searchParams.get('projectId');
            if (!projectId) return error('projectId required');
            try {
                const db = getFirestore(agentService.adminApp());
                const snap = await db.collection('users').doc(uid).collection('assistant_versions')
                    .where('projectId', '==', projectId)
                    .orderBy('updatedAt', 'desc')
                    .get();
                const versions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                return json({ versions });
            } catch (e: any) {
                return error(e.message || 'Fetch failed', 500);
            }
        }

        if (op === 'delete-version' && request.method === 'DELETE') {
            const versionId = url.searchParams.get('versionId');
            if (!versionId) return error('versionId required');
            try {
                const db = getFirestore(agentService.adminApp());
                await db.collection('users').doc(uid).collection('assistant_versions').doc(versionId).delete();
                return json({ success: true });
            } catch (e: any) {
                return error(e.message || 'Delete failed', 500);
            }
        }

        return error('Unknown op', 404);
    }
};

