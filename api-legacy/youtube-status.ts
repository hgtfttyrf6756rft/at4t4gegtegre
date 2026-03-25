import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const getAccessToken = async (uid: string): Promise<string> => {
    const clientId = (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
    const clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
        throw new Error('Missing YOUTUBE/GOOGLE_DRIVE CLIENT_ID/SECRET');
    }

    const db = getFirestore();
    const ref = db.doc(`users/${uid}/integrations/youtube`);
    const snap = await ref.get();
    const data = snap.data();
    const refreshToken = String(data?.refreshToken || '');

    if (!refreshToken) {
        throw new Error('YouTube not connected');
    }

    // Check if existing access token is valid (with buffer)
    if (data?.accessToken && data?.accessTokenExpiresAt && Date.now() < data.accessTokenExpiresAt - 60000) {
        return data.accessToken;
    }

    // Refresh token
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
        throw new Error('Failed to refresh YouTube token');
    }

    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    const accessToken = String(tokenJson.access_token || '');
    const expiresIn = Number(tokenJson.expires_in || 0);

    if (!accessToken) throw new Error('No access_token from refresh');

    // Update in DB
    await ref.update({
        accessToken,
        accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    });

    return accessToken;
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

        try {
            const accessToken = await getAccessToken(authResult.uid);

            // Fetch channel info
            const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (!channelRes.ok) {
                const errText = await channelRes.text().catch(() => 'Unknown error');
                console.error('[youtube-status] Failed to fetch channel info:', {
                    status: channelRes.status,
                    statusText: channelRes.statusText,
                    body: errText
                });
                // Return connected: true but channel: null if we have a token but can't fetch profile
                return json({ connected: true, channel: null }, 200);
            }

            const channelData = await channelRes.json();
            const channel = channelData.items?.[0];

            if (!channel) {
                return json({ connected: true, channel: null }, 200);
            }

            return json({
                connected: true,
                channel: {
                    id: channel.id,
                    title: channel.snippet.title,
                    description: channel.snippet.description,
                    thumbnailUrl: channel.snippet.thumbnails?.high?.url || channel.snippet.thumbnails?.medium?.url || channel.snippet.thumbnails?.default?.url,
                    subscriberCount: channel.statistics.subscriberCount,
                    videoCount: channel.statistics.videoCount,
                },
            }, 200);

        } catch (e: any) {
            if (e.message === 'YouTube not connected') {
                return json({ connected: false }, 200);
            }
            console.error('[youtube-status] Unexpected error:', e);
            // Even on general error (like refresh failure), if it's not "not connected", 
            // we might want to return connected: true if we have a token? 
            // But if getAccessToken throws, we don't know if they are connected.
            return error(e.message || 'Failed to get YouTube status', 500);
        }
    },
};
