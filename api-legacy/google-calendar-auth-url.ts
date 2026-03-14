import { requireAuth } from './_auth.js';

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const base64UrlEncode = (input: string): string => {
    const b64 = Buffer.from(input, 'utf8').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const getRedirectUri = (request: Request): string => {
    const explicit = (process.env.GOOGLE_CALENDAR_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    const url = new URL(request.url);
    // Using the same callback as Drive for now, assuming the backend can handle it or we reuse it?
    // Wait, if we use the same callback, the backend exchange must know to use calendar client ID/secret?
    // Actually, usually client ID/secret are shared for the project.
    return `${url.origin}/google-drive/callback`;
};

export default {
    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'GET') {
            return error('Method not allowed', 405);
        }

        const authResult = await requireAuth(request);
        if (authResult instanceof Response) {
            return authResult;
        }

        const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
        if (!clientId) {
            return error('Missing GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID environment variable.', 500);
        }

        const url = new URL(request.url);
        const returnTo = (url.searchParams.get('returnTo') || '/').trim() || '/';

        const redirectUri = `${url.origin}/google-calendar/callback`;

        const oauthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        oauthUrl.searchParams.set('client_id', clientId);
        oauthUrl.searchParams.set('redirect_uri', redirectUri);
        oauthUrl.searchParams.set('response_type', 'code');

        oauthUrl.searchParams.set(
            'scope',
            'https://www.googleapis.com/auth/calendar'
        );
        oauthUrl.searchParams.set('access_type', 'offline');
        oauthUrl.searchParams.set('prompt', 'consent');

        // Removed include_granted_scopes to prevent scope bleeding
        oauthUrl.searchParams.set('state', base64UrlEncode(JSON.stringify({ returnTo, provider: 'googleCalendar' })));

        return json({ url: oauthUrl.toString() }, 200);
    },
};
