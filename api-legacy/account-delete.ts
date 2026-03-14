import crypto from 'node:crypto';
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

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const deleteCollection = async (path: string, batchSize = 200) => {
  const col = adminDb.collection(path);

  while (true) {
    const snap = await col.limit(batchSize).get();
    if (snap.empty) break;

    const batch = adminDb.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    if (snap.size < batchSize) break;
  }
};

export async function POST(request: Request) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    return authResult;
  }

  const uid = authResult.uid;
  const code = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : crypto.randomBytes(16).toString('hex');

  const origin = new URL(request.url).origin;
  const statusUrl = `${origin}/ddi/deletion?code=${encodeURIComponent(code)}`;

  const now = new Date().toISOString();
  await adminDb.collection('dataDeletionRequests').doc(code).set(
    {
      platform: 'app',
      uid,
      status: 'received',
      requestedAt: now,
      completedAt: null,
      message: 'We received your deletion request and are processing it.',
      updatedAt: now,
    },
    { merge: true }
  );

  try {
    const projectsSnap = await adminDb.collection(`users/${uid}/projects`).get();
    for (const proj of projectsSnap.docs) {
      await deleteCollection(`users/${uid}/projects/${proj.id}/sessions`);
    }

    await deleteCollection(`users/${uid}/reports`);
    await deleteCollection(`users/${uid}/projects`);
    await deleteCollection(`users/${uid}/sharedProjects`);

    await adminDb.collection('users').doc(uid).delete().catch(() => undefined);

    const doneAt = new Date().toISOString();
    await adminDb.collection('dataDeletionRequests').doc(code).set(
      {
        status: 'completed',
        completedAt: doneAt,
        message: 'Deletion completed.',
        updatedAt: doneAt,
      },
      { merge: true }
    );
  } catch (e: any) {
    const failAt = new Date().toISOString();
    await adminDb.collection('dataDeletionRequests').doc(code).set(
      {
        status: 'pending',
        completedAt: null,
        message: e?.message || 'Deletion is still processing.',
        updatedAt: failAt,
      },
      { merge: true }
    );
  }

  return json({ url: statusUrl, confirmation_code: code }, 200);
}

export default {
  fetch: POST,
};
