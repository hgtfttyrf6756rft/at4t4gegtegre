import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'ffresearchr',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const adminDb = getFirestore();

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim();
  if (!code) {
    return json({ error: 'Missing code' }, 400);
  }

  const snap = await adminDb.collection('dataDeletionRequests').doc(code).get();
  if (!snap.exists) {
    return json({ error: 'Not found' }, 404);
  }

  const data = snap.data() || {};
  return json({
    confirmation_code: code,
    status: String(data.status || 'received'),
    requestedAt: data.requestedAt || null,
    completedAt: data.completedAt || null,
    message: data.message || null,
  });
}

export default {
  fetch: async (request: Request) => {
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405);
    }
    return GET(request);
  },
};
