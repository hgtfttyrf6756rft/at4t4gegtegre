import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';
import path from 'node:path';

type DecodedIdToken = {
  uid: string;
  email?: string;
  [key: string]: any;
};

let localEnvLoaded = false;

const loadLocalEnv = () => {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  const vercelEnv = (process.env.VERCEL_ENV || '').toLowerCase();
  if (process.env.NODE_ENV === 'production' || vercelEnv === 'production') return;

  const cwd = process.cwd();
  const candidates = ['.env.local', '.env'];

  for (const filename of candidates) {
    const fullPath = path.join(cwd, filename);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const contents = fs.readFileSync(fullPath, 'utf8');
      const lines = contents.split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#')) continue;

        const eqIndex = line.indexOf('=');
        if (eqIndex <= 0) continue;

        const key = line.slice(0, eqIndex).trim();
        let value = line.slice(eqIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
          process.env[key] = value;
        }
      }
    } catch {
      continue;
    }
  }
};

export const ensureFirebaseAdmin = () => {
  if (getApps().length) return;

  loadLocalEnv();

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    'ffresearchr';

  const rawServiceAccount =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.FIREBASE_ADMIN_CREDENTIALS ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
    process.env.VITE_FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.VITE_FIREBASE_SERVICE_ACCOUNT ||
    '';

  if (rawServiceAccount) {
    let parsed: any;
    try {
      parsed = JSON.parse(rawServiceAccount);
    } catch {
      throw new Error('Missing Firebase Admin credentials');
    }

    const clientEmail = parsed?.client_email || parsed?.clientEmail;
    const privateKey = (parsed?.private_key || parsed?.privateKey || '')
      .toString()
      .replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
      throw new Error('Missing Firebase Admin credentials');
    }

    initializeApp({
      credential: cert({
        projectId: parsed?.project_id || parsed?.projectId || projectId,
        clientEmail,
        privateKey,
      }),
    });

    return;
  }

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ||
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL ||
    process.env.FIREBASE_CLIENTEMAIL ||
    process.env.VITE_FIREBASE_CLIENT_EMAIL ||
    '';

  const privateKey =
    (process.env.FIREBASE_PRIVATE_KEY ||
      process.env.FIREBASE_ADMIN_PRIVATE_KEY ||
      process.env.FIREBASE_PRIVATEKEY ||
      process.env.VITE_FIREBASE_PRIVATE_KEY ||
      '')
      .toString()
      .replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    console.error('[api/_auth] Firebase Admin env check:', {
      FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
      FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      FIREBASE_ADMIN_CLIENT_EMAIL: Boolean(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
      FIREBASE_ADMIN_PRIVATE_KEY: Boolean(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
      FIREBASE_SERVICE_ACCOUNT_JSON: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
      FIREBASE_SERVICE_ACCOUNT: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
      FIREBASE_ADMIN_CREDENTIALS: Boolean(process.env.FIREBASE_ADMIN_CREDENTIALS),
      GOOGLE_APPLICATION_CREDENTIALS_JSON: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
      VITE_FIREBASE_CLIENT_EMAIL: Boolean(process.env.VITE_FIREBASE_CLIENT_EMAIL),
      VITE_FIREBASE_PRIVATE_KEY: Boolean(process.env.VITE_FIREBASE_PRIVATE_KEY),
      VITE_FIREBASE_SERVICE_ACCOUNT_JSON: Boolean(process.env.VITE_FIREBASE_SERVICE_ACCOUNT_JSON),
      VITE_FIREBASE_SERVICE_ACCOUNT: Boolean(process.env.VITE_FIREBASE_SERVICE_ACCOUNT),
    });
    throw new Error('Missing Firebase Admin credentials');
  }

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
};

export type AuthContext = {
  uid: string;
  token: DecodedIdToken;
};

const jsonError = (message: string, status = 401) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function requireAuth(request: Request): Promise<AuthContext | Response> {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) {
    return jsonError('Missing Authorization header', 401);
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return jsonError('Invalid Authorization header format', 401);
  }

  const idToken = match[1];
  if (!idToken) {
    return jsonError('Missing bearer token', 401);
  }

  try {
    ensureFirebaseAdmin();
    const token = (await getAuth().verifyIdToken(idToken)) as DecodedIdToken;
    if (!token?.uid) {
      return jsonError('Invalid token', 401);
    }
    return { uid: token.uid, token };
  } catch (error: any) {
    const message = (error?.message || '').toString();
    if (
      message.includes('Missing Firebase Admin credentials') ||
      message.includes('Missing FIREBASE_CLIENT_EMAIL') ||
      message.includes('Missing FIREBASE_PRIVATE_KEY')
    ) {
      console.error('[api/_auth] Firebase Admin is not configured:', error);
      return jsonError('Server configuration error: Firebase Admin credentials are missing', 500);
    }
    console.error('[api/_auth] Token verification failed:', error);
    return jsonError('Unauthorized', 401);
  }
}
