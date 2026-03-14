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

    if (data?.accessToken && data?.accessTokenExpiresAt && Date.now() < data.accessTokenExpiresAt - 60000) {
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
        throw new Error('Failed to refresh YouTube token');
    }

    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    const accessToken = String(tokenJson.access_token || '');
    const expiresIn = Number(tokenJson.expires_in || 0);

    if (!accessToken) throw new Error('No access_token from refresh');

    await ref.update({
        accessToken,
        accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    });

    return accessToken;
};

type InitBody = {
    title: string;
    description?: string;
    privacyStatus?: 'public' | 'private' | 'unlisted';
    tags?: string[];
    categoryId?: string;
    madeForKids?: boolean;
    notifySubscribers?: boolean;
    publishAt?: string; // Optional: separate for scheduled date
    mimeType?: string;
};

export default {
    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'POST') {
            return error('Method not allowed', 405);
        }

        const authResult = await requireAuth(request);
        if (authResult instanceof Response) {
            return authResult;
        }

        let body: InitBody;
        try {
            body = (await request.json()) as InitBody;
        } catch {
            return error('Invalid JSON body', 400);
        }

        try {
            const accessToken = await getAccessToken(authResult.uid);

            // Metadata for the video
            const metadata = {
                snippet: {
                    title: body.title || 'Untitled Video',
                    description: body.description || '',
                    tags: body.tags || [],
                    categoryId: body.categoryId || '22', // 22 = People & Blogs
                },
                status: {
                    privacyStatus: body.privacyStatus || 'public',
                    selfDeclaredMadeForKids: !!body.madeForKids,
                },
            };

            // Initiate Resumable Upload
            // https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol#Start_Session
            const notifySubscribers = body.notifySubscribers !== false; // Default true
            const mimeType = body.mimeType || 'video/mp4';

            const origin = request.headers.get('origin') || 'https://www.freshfront.co';

            const initRes = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${notifySubscribers}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Upload-Content-Type': mimeType,
                    'Origin': origin,
                    'X-Goog-Upload-Origin': origin,
                },
                body: JSON.stringify(metadata),
            });

            if (!initRes.ok) {
                const text = await initRes.text();
                return error(`YouTube upload init failed: ${initRes.status} ${text}`, initRes.status);
            }

            const uploadUrl = initRes.headers.get('Location');
            if (!uploadUrl) {
                return error('No upload URL returned from YouTube', 500);
            }

            return json({ uploadUrl }, 200);
        } catch (e: any) {
            return error(e.message || 'Failed to initiate YouTube upload', 500);
        }
    },
};
