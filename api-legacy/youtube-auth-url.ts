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
    const explicit = (process.env.YOUTUBE_REDIRECT_URI || '').trim();
    if (explicit) return explicit;

    // Fallback to Google Drive redirect URI if available (often shared)
    const driveRedirect = (process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim();
    if (driveRedirect) return driveRedirect;

    const url = new URL(request.url);
    return `${url.origin}/youtube/callback`;
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

        const clientId = (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
        if (!clientId) {
            return error('Missing YOUTUBE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID environment variable.', 500);
        }

        const url = new URL(request.url);
        const returnTo = (url.searchParams.get('returnTo') || '/').trim() || '/';

        const redirectUri = getRedirectUri(request);

        const oauthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        oauthUrl.searchParams.set('client_id', clientId);
        oauthUrl.searchParams.set('redirect_uri', redirectUri);
        oauthUrl.searchParams.set('response_type', 'code');

        oauthUrl.searchParams.set(
            'scope',
            'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
        );
        oauthUrl.searchParams.set('access_type', 'offline');
        oauthUrl.searchParams.set('prompt', 'consent');

        // State helps prevent CSRF and pass state (returnTo)
        oauthUrl.searchParams.set('state', base64UrlEncode(JSON.stringify({ returnTo })));

        return json({ url: oauthUrl.toString() }, 200);
    },
};
