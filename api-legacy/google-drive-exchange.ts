import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

type RequestBody = {
  code?: string;
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const getRedirectUri = (request: Request): string => {
  const explicit = (process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.origin}/google-drive/callback`;
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

    const clientId = (process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
      return error('Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET environment variable.', 500);
    }

    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return error('Invalid JSON body', 400);
    }

    const code = (body.code || '').toString().trim();
    if (!code) return error('Missing code', 400);

    const redirectUri = getRedirectUri(request);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => tokenRes.statusText);
      return error(`Token exchange failed: ${tokenRes.status}`, tokenRes.status, text);
    }

    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    const refreshToken = (tokenJson.refresh_token || '').toString();
    const accessToken = (tokenJson.access_token || '').toString();
    const expiresIn = Number(tokenJson.expires_in || 0);

    if (!accessToken) {
      return error('Token exchange returned no access_token', 500, tokenJson);
    }

    const db = getFirestore();
    const ref = db.doc(`users/${authResult.uid}/integrations/googleDrive`);

    const existing = await ref.get().catch(() => null);
    const existingRefreshToken = existing?.exists ? String(existing.data()?.refreshToken || '') : '';

    const nextRefreshToken = refreshToken || existingRefreshToken;

    await ref.set(
      {
        provider: 'googleDrive',
        refreshToken: nextRefreshToken || null,
        accessToken,
        accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
        scope: String(tokenJson.scope || ''),
        tokenType: String(tokenJson.token_type || ''),
        updatedAt: Date.now(),
      },
      { merge: true },
    );

    return json({ connected: Boolean(nextRefreshToken) }, 200);
  },
};
