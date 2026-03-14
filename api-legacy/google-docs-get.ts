import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const parseGoogleAuthError = (status: number, raw: string) => {
  const text = (raw || '').toString();
  const lower = text.toLowerCase();
  const insufficientScopes =
    (lower.includes('insufficient') && lower.includes('scope')) ||
    lower.includes('insufficient authentication scopes');
  const unauthorized = status === 401 || status === 403;
  return {
    needsReauth: unauthorized && (insufficientScopes || lower.includes('invalid_grant') || lower.includes('unauthorized')),
    raw: text,
  };
};

const getAccessToken = async (uid: string): Promise<string> => {
  const clientId = (process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET');
  }

  const db = getFirestore();
  const ref = db.doc(`users/${uid}/integrations/googleDrive`);
  const snap = await ref.get();
  const refreshToken = String(snap.data()?.refreshToken || '');
  if (!refreshToken) {
    throw new Error('Google Drive not connected');
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
    const text = await tokenRes.text().catch(() => tokenRes.statusText);
    throw new Error(`Failed to refresh token: ${tokenRes.status} ${text || ''}`.trim());
  }

  const tokenJson: any = await tokenRes.json().catch(() => ({}));
  const accessToken = String(tokenJson.access_token || '');
  if (!accessToken) throw new Error('Token refresh returned no access_token');
  return accessToken;
};

const extractPlainTextFromDoc = (doc: any): string => {
  const body = doc?.body;
  const content = Array.isArray(body?.content) ? body.content : [];

  const parts: string[] = [];

  for (const el of content) {
    const para = el?.paragraph;
    if (!para) continue;
    const elements = Array.isArray(para?.elements) ? para.elements : [];

    for (const pe of elements) {
      const tr = pe?.textRun;
      if (tr && typeof tr.content === 'string') {
        parts.push(tr.content);
      }
    }
  }

  const joined = parts.join('');
  return joined.replace(/\r\n/g, '\n');
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
      const url = new URL(request.url);
      const documentId = (url.searchParams.get('documentId') || '').trim();
      if (!documentId) return error('Missing documentId', 400);

      const clientAccessToken = (url.searchParams.get('accessToken') || '').trim();
      const accessToken = clientAccessToken || await getAccessToken(authResult.uid);

      const apiUrl = new URL(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
      apiUrl.searchParams.set('fields', 'documentId,title,body');

      const res = await fetch(apiUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        const parsed = parseGoogleAuthError(res.status, text);
        if (parsed.needsReauth) {
          return json({ error: 'Google Docs authorization needs to be refreshed', needsReauth: true, details: parsed.raw }, res.status);
        }
        console.error('[Google API] Docs get failed:', res.status, text);
        return error(`Docs get failed: ${res.status}`, res.status, text);
      }

      const data: any = await res.json().catch(() => ({}));
      const plainText = extractPlainTextFromDoc(data);

      let bodyEndIndex = 1;
      const elements = Array.isArray(data?.body?.content) ? data.body.content : [];
      const last = elements.length ? elements[elements.length - 1] : null;
      if (last && typeof last.endIndex === 'number') {
        bodyEndIndex = last.endIndex;
      } else {
        for (const el of elements) {
          if (typeof el?.endIndex === 'number') bodyEndIndex = Math.max(bodyEndIndex, el.endIndex);
        }
      }

      return json(
        {
          documentId: String(data?.documentId || documentId),
          title: String(data?.title || ''),
          text: plainText,
          bodyEndIndex,
        },
        200,
      );
    } catch (e: any) {
      return error(e?.message || 'Docs get failed', 500);
    }
  },
};
