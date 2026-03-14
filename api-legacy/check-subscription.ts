import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireAuth } from './_auth.js';

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

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (authResult.uid !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized: userId mismatch' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userDoc = await adminDb.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return new Response(JSON.stringify({ subscribed: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userData = userDoc.data();
    
    return new Response(JSON.stringify({ 
      subscribed: userData?.subscribed || false,
      subscriptionId: userData?.subscriptionId || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error checking subscription:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  fetch: POST,
};
