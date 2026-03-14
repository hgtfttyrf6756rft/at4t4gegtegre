import { requireAuth, ensureFirebaseAdmin } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';
import { Client as QStashClient, Receiver } from '@upstash/qstash';

// QStash client for email scheduling
let qstashClient: QStashClient | null = null;
const getQStashClient = () => {
    if (!qstashClient) {
        qstashClient = new QStashClient({ token: process.env.QSTASH_TOKEN! });
    }
    return qstashClient;
};

// Get base URL for QStash callbacks
const getScheduleBaseUrl = () => {
    if (process.env.NEXT_PUBLIC_BASE_URL) {
        return process.env.NEXT_PUBLIC_BASE_URL;
    }
    return 'https://www.freshfront.co';
};

// Scheduled email type
interface ScheduledEmail {
    id?: string;
    projectId: string;
    userId: string;
    scheduledAt: number;
    status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
    provider: 'gmail' | 'outlook';
    to: string | string[];
    subject: string;
    html: string;
    attachments?: Array<{ filename: string; content: string; type: string }>;
    qstashMessageId?: string;
    createdAt: number;
    sentAt?: number;
    error?: string;
}

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const getRedirectUri = (request: Request, provider: 'gmail' | 'outlook'): string => {
    if (provider === 'gmail') {
        const explicit = (process.env.GMAIL_REDIRECT_URI || '').trim();
        if (explicit) return explicit;
        const url = new URL(request.url, 'http://localhost');
        return `${url.origin}/gmail/callback`;
    } else {
        const explicit = (process.env.OUTLOOK_REDIRECT_URI || '').trim();
        if (explicit) return explicit;
        const url = new URL(request.url, 'http://localhost');
        return `${url.origin}/outlook/callback`;
    }
};

const getGmailAccessToken = async (uid: string): Promise<string> => {
    const clientId = (process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
        throw new Error('Missing GMAIL_CLIENT_ID/SECRET');
    }

    const db = getFirestore();
    const ref = db.doc(`users/${uid}/integrations/gmail`);
    const snap = await ref.get();
    let refreshToken = String(snap.data()?.refreshToken || '');
    if (!refreshToken) {
        throw new Error('Gmail not connected');
    }

    // Check if access token is valid
    const data = snap.data();
    if (data?.accessToken && data?.accessTokenExpiresAt && data.accessTokenExpiresAt > Date.now() + 60000) {
        return data.accessToken;
    }

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

    if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => tokenRes.statusText);
        throw new Error(`Failed to refresh token: ${tokenRes.status} ${text || ''}`.trim());
    }

    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    const accessToken = String(tokenJson.access_token || '');
    const expiresIn = Number(tokenJson.expires_in || 0);

    if (!accessToken) throw new Error('Token refresh returned no access_token');

    const targetRef = ref;
    await targetRef.set({
        accessToken,
        accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    }, { merge: true });

    return accessToken;
};

const getOutlookAccessToken = async (uid: string): Promise<string> => {
    const clientId = (process.env.OUTLOOK_CLIENT_ID || '').trim();
    const clientSecret = (process.env.OUTLOOK_CLIENT_SECRET || '').trim();
    const tenantId = (process.env.OUTLOOK_TENANT_ID || 'common').trim();

    if (!clientId || !clientSecret) {
        throw new Error('Missing OUTLOOK_CLIENT_ID/SECRET');
    }

    const db = getFirestore();
    const ref = db.doc(`users/${uid}/integrations/outlook`);
    const snap = await ref.get();
    const refreshToken = String(snap.data()?.refreshToken || '');

    if (!refreshToken) {
        throw new Error('Outlook not connected');
    }

    // Check valid
    const data = snap.data();
    if (data?.accessToken && data?.accessTokenExpiresAt && data.accessTokenExpiresAt > Date.now() + 60000) {
        return data.accessToken;
    }

    // Refresh
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: 'https://graph.microsoft.com/mail.send offline_access',
        }).toString(),
    });

    if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => tokenRes.statusText);
        throw new Error(`Failed to refresh token: ${tokenRes.status} ${text || ''}`.trim());
    }

    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    const accessToken = String(tokenJson.access_token || '');
    const expiresIn = Number(tokenJson.expires_in || 0);

    if (!accessToken) throw new Error('Token refresh returned no access_token');

    await ref.set({
        accessToken,
        accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    }, { merge: true });

    return accessToken;
};

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url, 'http://localhost');
        const op = (url.searchParams.get('op') || '').trim();
        // Provider can be passed, or inferred from op prefix if we added one (but currently we don't for email).
        // Frontend sends ?op=send&provider=gmail etc if I update frontend.
        // Or I can look at existing code: frontend used `/api/gmail?op=...`. 
        // New frontend will use `/api/email?op=...&provider=...` or `/api/email?op=...` and infer from query param.

        // Let's assume frontend passes `provider` param, OR `op` is prefixed (not planned).
        // We will stick to `op` param and `provider` param.

        // HOWEVER, auth-url might not pass provider if frontend logic is rigid, but I am updating frontend.
        // Wait, for `auth-url`, `ProjectAssets.tsx` sends `op=auth-url`. It MUST also send `provider` or use specific ops.
        // I will use `provider` query param.

        const provider = (url.searchParams.get('provider') || '').trim().toLowerCase();

        // Special case: if provider is missing but we can guess from context? No, require it for auth/status/send.
        // Except for `exchange`, where the callback might not have provider? 
        // Actually `exchange` receives `code`. The callback URL `/gmail/callback` page triggers the exchange. 
        // That page MUST start the exchange with provider info. 
        // `App.tsx` calls `/api/gmail?op=exchange`. Now it will call `/api/email?op=exchange&provider=gmail`.

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                },
            });
        }

        try {
            // Handle QStash callback BEFORE requireAuth (QStash uses signature verification, not Firebase tokens)
            if (op === 'email-schedule-execute') {
                console.log('[Email Execute] ======= ENTRY POINT (QStash Callback) =======');

                // Verify this is a legitimate QStash callback by checking the signature
                const qstashSignature = request.headers.get('upstash-signature');
                if (!qstashSignature) {
                    console.error('[Email Execute] Missing QStash signature');
                    return error('Unauthorized: Missing QStash signature', 401);
                }

                // Proper signature verification using Receiver
                const receiver = new Receiver({
                    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
                    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
                });

                const rawBody = await request.text();
                const isValid = await receiver.verify({
                    signature: qstashSignature,
                    body: rawBody,
                    url: request.url,
                }).catch(err => {
                    console.error('[Email Execute] Signature verification error:', err);
                    return false;
                });

                if (!isValid) {
                    console.error('[Email Execute] Invalid QStash signature');
                    return error('Unauthorized: Invalid QStash signature', 401);
                }

                const body = JSON.parse(rawBody);
                const { scheduledEmailId } = body;

                if (!scheduledEmailId) return error('Missing scheduledEmailId', 400);

                // Initialize Firebase Admin before using Firestore
                ensureFirebaseAdmin();

                const db = getFirestore();
                const docRef = db.collection('scheduledEmails').doc(scheduledEmailId);
                const doc = await docRef.get();

                if (!doc.exists) return error('Scheduled email not found', 404);

                const email = doc.data() as ScheduledEmail;
                console.log('[Email Execute] Email data:', { userId: email.userId, provider: email.provider, status: email.status });

                if (email.status !== 'scheduled') {
                    return json({ success: true, message: `Email already ${email.status}` });
                }

                await docRef.update({ status: 'sending' });

                try {
                    // Get access token for the user's provider
                    let accessToken: string;
                    if (email.provider === 'gmail') {
                        accessToken = await getGmailAccessToken(email.userId);
                    } else {
                        accessToken = await getOutlookAccessToken(email.userId);
                    }

                    // Handle multiple recipients
                    const recipients = Array.isArray(email.to) ? email.to : [email.to];
                    let successCount = 0;
                    let lastError = '';

                    for (const toEmail of recipients) {
                        try {
                            if (email.provider === 'gmail') {
                                // Construct MIME message
                                const boundary = "foo_bar_baz";
                                let messageParts = [
                                    `Content-Type: multipart/mixed; boundary="${boundary}"`,
                                    "MIME-Version: 1.0",
                                    `To: ${toEmail}`,
                                    `Subject: ${email.subject}`,
                                    "",
                                    `--${boundary}`,
                                    "Content-Type: text/html; charset=UTF-8",
                                    "Content-Transfer-Encoding: 7bit",
                                    "",
                                    email.html,
                                    ""
                                ];

                                if (email.attachments && Array.isArray(email.attachments)) {
                                    for (const att of email.attachments) {
                                        messageParts.push(`--${boundary}`);
                                        messageParts.push(`Content-Type: ${att.type || 'application/octet-stream'}`);
                                        messageParts.push(`Content-Transfer-Encoding: base64`);
                                        messageParts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
                                        messageParts.push("");
                                        messageParts.push(att.content);
                                        messageParts.push("");
                                    }
                                }

                                messageParts.push(`--${boundary}--`);
                                const rawMessage = messageParts.join("\r\n");
                                const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

                                const sendRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${accessToken}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ raw: encodedMessage })
                                });

                                if (sendRes.ok) successCount++;
                                else lastError = await sendRes.text();
                            } else {
                                // Outlook
                                const messagePayload: any = {
                                    message: {
                                        subject: email.subject,
                                        body: { contentType: "HTML", content: email.html },
                                        toRecipients: [{ emailAddress: { address: toEmail } }],
                                    },
                                    saveToSentItems: true,
                                };

                                if (email.attachments && Array.isArray(email.attachments)) {
                                    messagePayload.message.attachments = email.attachments.map(att => ({
                                        '@odata.type': '#microsoft.graph.fileAttachment',
                                        name: att.filename,
                                        contentType: att.type || 'application/octet-stream',
                                        contentBytes: att.content,
                                    }));
                                }

                                const sendRes = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${accessToken}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify(messagePayload)
                                });

                                if (sendRes.ok || sendRes.status === 202) successCount++;
                                else lastError = await sendRes.text();
                            }
                        } catch (recipientError: any) {
                            lastError = recipientError?.message || 'Failed to send to recipient';
                        }
                    }

                    if (successCount === recipients.length) {
                        await docRef.update({ status: 'sent', sentAt: Math.floor(Date.now() / 1000) });
                        console.log('[Email Execute] SUCCESS! All emails sent:', { successCount, total: recipients.length });
                        return json({ success: true, sent: successCount, total: recipients.length });
                    } else if (successCount > 0) {
                        await docRef.update({ status: 'sent', sentAt: Math.floor(Date.now() / 1000), error: `Partial: ${successCount}/${recipients.length}` });
                        return json({ success: true, partial: true, sent: successCount, total: recipients.length, lastError });
                    } else {
                        await docRef.update({ status: 'failed', error: lastError });
                        return error(`Failed to send: ${lastError}`, 500);
                    }
                } catch (sendError: any) {
                    await docRef.update({ status: 'failed', error: sendError?.message || 'Unknown error' });
                    console.error('[Email Execute] Error:', sendError);
                    return error(sendError?.message || 'Failed to send email', 500);
                }
            }

            const authResult = await requireAuth(request);
            if (authResult instanceof Response) return authResult;
            const { uid } = authResult;

            // 1. Auth URL
            if (op === 'auth-url') {
                if (!provider) return error('Missing provider', 400);

                if (provider === 'gmail') {
                    const clientId = (process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
                    if (!clientId) return error('Missing Client ID', 500);

                    const redirectUri = getRedirectUri(request, 'gmail');
                    const returnTo = (url.searchParams.get('returnTo') || '/').trim();

                    const oauthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
                    oauthUrl.searchParams.set('client_id', clientId);
                    oauthUrl.searchParams.set('redirect_uri', redirectUri);
                    oauthUrl.searchParams.set('response_type', 'code');
                    oauthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.send');
                    oauthUrl.searchParams.set('access_type', 'offline');
                    oauthUrl.searchParams.set('prompt', 'consent');
                    oauthUrl.searchParams.set('state', Buffer.from(JSON.stringify({ returnTo })).toString('base64'));

                    return json({ url: oauthUrl.toString() });
                }

                if (provider === 'outlook') {
                    const clientId = (process.env.OUTLOOK_CLIENT_ID || '').trim();
                    const tenantId = (process.env.OUTLOOK_TENANT_ID || 'common').trim();
                    if (!clientId) return error('Missing Client ID', 500);

                    const redirectUri = getRedirectUri(request, 'outlook');
                    const returnTo = (url.searchParams.get('returnTo') || '/').trim();

                    const oauthUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
                    oauthUrl.searchParams.set('client_id', clientId);
                    oauthUrl.searchParams.set('response_type', 'code');
                    oauthUrl.searchParams.set('redirect_uri', redirectUri);
                    oauthUrl.searchParams.set('response_mode', 'query');
                    oauthUrl.searchParams.set('scope', 'https://graph.microsoft.com/mail.send offline_access openid profile email');
                    oauthUrl.searchParams.set('state', Buffer.from(JSON.stringify({ returnTo })).toString('base64'));

                    return json({ url: oauthUrl.toString() });
                }

                return error('Invalid provider', 400);
            }

            // 2. Exchange Code
            if (op === 'exchange') {
                const body: any = await request.json().catch(() => ({}));
                const code = body.code;
                const bodyProvider = body.provider || provider; // Support body or query

                if (!code) return error('Missing code', 400);
                if (!bodyProvider) return error('Missing provider', 400);

                if (bodyProvider === 'gmail') {
                    const clientId = (process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
                    const clientSecret = (process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
                    if (!clientId || !clientSecret) return error('Missing Client ID/Secret', 500);

                    const redirectUri = getRedirectUri(request, 'gmail');

                    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            code,
                            client_id: clientId,
                            client_secret: clientSecret,
                            redirect_uri: redirectUri,
                            grant_type: 'authorization_code',
                        }).toString(),
                    });

                    if (!tokenRes.ok) {
                        return error('Token exchange failed', 400, await tokenRes.text());
                    }

                    const tokenJson: any = await tokenRes.json();
                    const db = getFirestore();
                    await db.doc(`users/${uid}/integrations/gmail`).set({
                        refreshToken: tokenJson.refresh_token,
                        accessToken: tokenJson.access_token,
                        accessTokenExpiresAt: Date.now() + (tokenJson.expires_in * 1000),
                        updatedAt: Date.now(),
                    }, { merge: true });

                    return json({ success: true });
                }

                if (bodyProvider === 'outlook') {
                    const clientId = (process.env.OUTLOOK_CLIENT_ID || '').trim();
                    const clientSecret = (process.env.OUTLOOK_CLIENT_SECRET || '').trim();
                    const tenantId = (process.env.OUTLOOK_TENANT_ID || 'common').trim();
                    if (!clientId || !clientSecret) return error('Missing Client ID/Secret', 500);

                    const redirectUri = getRedirectUri(request, 'outlook');

                    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
                    const tokenRes = await fetch(tokenUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            client_id: clientId,
                            client_secret: clientSecret,
                            code,
                            redirect_uri: redirectUri,
                            grant_type: 'authorization_code',
                        }).toString(),
                    });

                    if (!tokenRes.ok) {
                        return error('Token exchange failed', 400, await tokenRes.text());
                    }

                    const tokenJson: any = await tokenRes.json();
                    const db = getFirestore();
                    await db.doc(`users/${uid}/integrations/outlook`).set({
                        refreshToken: tokenJson.refresh_token,
                        accessToken: tokenJson.access_token,
                        accessTokenExpiresAt: Date.now() + (tokenJson.expires_in * 1000),
                        updatedAt: Date.now(),
                    }, { merge: true });

                    return json({ success: true });
                }

                return error('Invalid provider', 400);
            }

            // 3. Send Email
            if (op === 'send') {
                // Frontend might send provider in body or query. Let's check query first.
                // Actually body logic for send is cleaner? No, keeping consistent. Assume query param.
                // Or look for it in body if missing.
                let body = await request.json().catch(() => ({}));
                const { to, subject, html, attachments } = body;
                const sendProvider = provider || body.provider;

                if (!sendProvider) return error('Missing provider', 400);

                if (sendProvider === 'gmail') {
                    if (!to || !subject || !html) return error('Missing required fields', 400);
                    const accessToken = await getGmailAccessToken(uid);

                    // Construct MIME message
                    const boundary = "foo_bar_baz";
                    let messageParts = [
                        `Content-Type: multipart/mixed; boundary="${boundary}"`,
                        "MIME-Version: 1.0",
                        `To: ${to}`,
                        `Subject: ${subject}`,
                        "",
                        `--${boundary}`,
                        "Content-Type: text/html; charset=UTF-8",
                        "Content-Transfer-Encoding: 7bit",
                        "",
                        html,
                        ""
                    ];

                    if (attachments && Array.isArray(attachments)) {
                        for (const att of attachments) {
                            messageParts.push(`--${boundary}`);
                            messageParts.push(`Content-Type: ${att.type || 'application/octet-stream'}`);
                            messageParts.push(`Content-Transfer-Encoding: base64`);
                            messageParts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
                            messageParts.push("");
                            messageParts.push(att.content); // Assumed base64
                            messageParts.push("");
                        }
                    }

                    messageParts.push(`--${boundary}--`);
                    const rawMessage = messageParts.join("\r\n");
                    const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

                    const sendRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            raw: encodedMessage
                        })
                    });

                    if (!sendRes.ok) {
                        return error('Failed to send email via Gmail', sendRes.status, await sendRes.text());
                    }

                    const data = await sendRes.json();
                    return json({ success: true, id: data.id });
                }

                if (sendProvider === 'outlook') {
                    const accessToken = await getOutlookAccessToken(uid);

                    const message: any = {
                        subject,
                        body: {
                            contentType: 'HTML',
                            content: html
                        },
                        toRecipients: [
                            { emailAddress: { address: to } }
                        ]
                    };

                    if (attachments && Array.isArray(attachments)) {
                        message.attachments = attachments.map((att: any) => ({
                            '@odata.type': '#microsoft.graph.fileAttachment',
                            name: att.filename,
                            contentBytes: att.content // Base64
                        }));
                    }

                    const sendRes = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ message })
                    });

                    if (!sendRes.ok) {
                        return error('Failed to send email via Outlook', sendRes.status, await sendRes.text());
                    }

                    // 202 Accepted
                    return json({ success: true });
                }

                return error('Invalid provider', 400);
            }

            // 4. Status
            if (op === 'status') {
                const statusProvider = provider;
                if (!statusProvider) return error('Missing provider', 400);

                const db = getFirestore();
                if (statusProvider === 'gmail') {
                    const doc = await db.doc(`users/${uid}/integrations/gmail`).get();
                    return json({ connected: doc.exists && !!doc.data()?.refreshToken });
                }
                if (statusProvider === 'outlook') {
                    const doc = await db.doc(`users/${uid}/integrations/outlook`).get();
                    return json({ connected: doc.exists && !!doc.data()?.refreshToken });
                }
                return error('Invalid provider', 400);
            }

            // 5. Disconnect
            if (op === 'disconnect') {
                const disconnectProvider = provider;
                if (!disconnectProvider) return error('Missing provider', 400);

                const db = getFirestore();
                if (disconnectProvider === 'gmail') {
                    await db.doc(`users/${uid}/integrations/gmail`).delete();
                    return json({ success: true });
                }
                if (disconnectProvider === 'outlook') {
                    await db.doc(`users/${uid}/integrations/outlook`).delete();
                    return json({ success: true });
                }
                return error('Invalid provider', 400);
            }

            // ═══════════════════════════════════════════════════════════════════════════
            // EMAIL SCHEDULING OPERATIONS (QStash-based)
            // ═══════════════════════════════════════════════════════════════════════════

            // 5. Schedule Email
            if (op === 'email-schedule-create') {
                console.log('[Email Schedule] ======= ENTRY POINT =======');
                const body = await request.json().catch(() => ({}));
                const { projectId, scheduledAt, provider: schedProvider, to, subject, html, attachments } = body;

                if (!projectId) return error('Missing projectId', 400);
                if (!scheduledAt) return error('Missing scheduledAt', 400);
                if (!schedProvider) return error('Missing provider', 400);
                if (!to) return error('Missing recipient(s)', 400);
                if (!subject) return error('Missing subject', 400);
                if (!html) return error('Missing HTML content', 400);

                // Validate time bounds (10 min to 7 days)
                const now = Math.floor(Date.now() / 1000);
                const minTime = now + 600;
                const maxTime = now + 7 * 24 * 60 * 60;

                if (scheduledAt < minTime) return error('Scheduled time must be at least 10 minutes in the future', 400);
                if (scheduledAt > maxTime) return error('Scheduled time cannot be more than 7 days in the future', 400);

                const db = getFirestore();
                const qstash = getQStashClient();

                const emailData: ScheduledEmail = {
                    projectId,
                    userId: uid,
                    scheduledAt,
                    status: 'scheduled',
                    provider: schedProvider,
                    to,
                    subject,
                    html,
                    attachments: attachments || [],
                    createdAt: now,
                };

                console.log('[Email Schedule] Saving scheduled email:', {
                    projectId,
                    userId: uid,
                    scheduledAt: new Date(scheduledAt * 1000).toISOString(),
                    provider: schedProvider,
                    recipientCount: Array.isArray(to) ? to.length : 1,
                });

                const docRef = await db.collection('scheduledEmails').add(emailData);
                const emailId = docRef.id;

                // Build headers for Vercel Deployment Protection bypass
                const bypassHeaders: Record<string, string> = {};
                const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
                if (bypassSecret) {
                    bypassHeaders['x-vercel-protection-bypass'] = bypassSecret;
                }

                const result = await qstash.publishJSON({
                    url: `${getScheduleBaseUrl()}/api/email?op=email-schedule-execute`,
                    body: { scheduledEmailId: emailId },
                    notBefore: scheduledAt,
                    retries: 3,
                    headers: bypassHeaders,
                });

                await docRef.update({ qstashMessageId: result.messageId });

                console.log('[Email Schedule] SUCCESS! Email scheduled:', {
                    emailId,
                    qstashMessageId: result.messageId,
                    scheduledAtDate: new Date(scheduledAt * 1000).toISOString()
                });

                return json({ success: true, scheduledEmailId: emailId, qstashMessageId: result.messageId, scheduledAt });
            }
            // Note: email-schedule-execute is handled before requireAuth (see above)

            // 7. List Scheduled Emails
            if (op === 'email-schedule-list') {
                const projectId = (url.searchParams.get('projectId') || '').trim();
                if (!projectId) return error('Missing projectId', 400);

                const db = getFirestore();
                const snapshot = await db.collection('scheduledEmails')
                    .where('userId', '==', uid)
                    .where('projectId', '==', projectId)
                    .orderBy('scheduledAt', 'desc')
                    .limit(50)
                    .get();

                const emails = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                return json({ emails });
            }

            return error('Invalid operation', 400);
        } catch (e: any) {
            console.error('[Email API] Error:', e);
            return error(e.message || 'Internal Server Error', 500);
        }
    }
};
