import crypto from 'node:crypto';
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

const base64UrlToBuffer = (input: string): Buffer => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  return Buffer.from(padded, 'base64');
};

const parseSignedRequest = (signedRequest: string, appSecret: string) => {
  const parts = (signedRequest || '').split('.', 2);
  if (parts.length !== 2) {
    throw new Error('Invalid signed_request');
  }

  const [encodedSig, payload] = parts;
  const sig = base64UrlToBuffer(encodedSig);

  const expected = crypto.createHmac('sha256', appSecret).update(payload).digest();
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
    throw new Error('Bad signed_request signature');
  }

  const data = JSON.parse(base64UrlToBuffer(payload).toString('utf8'));
  return data;
};

export async function POST(request: Request) {
  const secret =
    (process.env.FACEBOOK_APP_SECRET ||
      process.env.META_APP_SECRET ||
      process.env.FB_APP_SECRET ||
      '').trim();

  if (!secret) {
    return json({ error: 'Server configuration error: missing app secret' }, 500);
  }

  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const signedRequest = (params.get('signed_request') || '').trim();
  if (!signedRequest) {
    return json({ error: 'Missing signed_request' }, 400);
  }

  let data: any;
  try {
    data = parseSignedRequest(signedRequest, secret);
  } catch (e: any) {
    return json({ error: e?.message || 'Invalid signed_request' }, 400);
  }

  const userId = String(data?.user_id || '').trim();
  if (!userId) {
    return json({ error: 'Missing user_id' }, 400);
  }

  const code = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : crypto.randomBytes(16).toString('hex');

  const origin = new URL(request.url).origin;
  const statusUrl = `${origin}/ddi/deletion?code=${encodeURIComponent(code)}`;

  const now = new Date().toISOString();
  await adminDb.collection('dataDeletionRequests').doc(code).set(
    {
      platform: 'meta',
      platformUserId: userId,
      status: 'completed',
      requestedAt: now,
      completedAt: now,
      message:
        'We received your deletion request. This app does not store Facebook-provided user data beyond the app-scoped identifier contained in the request, so there is no Facebook-scoped data to delete. If you also have an in-app account, you can delete that data from /ddi while signed in.',
      updatedAt: now,
    },
    { merge: true }
  );

  return json({ url: statusUrl, confirmation_code: code }, 200);
}

export default {
  fetch: async (request: Request) => {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }
    return POST(request);
  },
};
