import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (message: string, status = 400) => json({ error: message }, status);

export default {
    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'GET') {
            return error('Method not allowed', 405);
        }

        const authResult = await requireAuth(request);
        if (authResult instanceof Response) {
            return authResult;
        }

        const db = getFirestore();
        const ref = db.doc(`users/${authResult.uid}/integrations/tiktok`);
        const snap = await ref.get().catch(() => null);

        const refreshToken = snap?.exists ? String(snap.data()?.refreshToken || '') : '';
        const openId = snap?.exists ? String(snap.data()?.openId || '') : '';

        return json({ connected: Boolean(refreshToken), openId }, 200);
    },
};
