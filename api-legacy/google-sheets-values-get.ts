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
    lower.includes('insufficient') && lower.includes('scope') ||
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
      const spreadsheetId = (url.searchParams.get('spreadsheetId') || '').trim();
      const range = (url.searchParams.get('range') || '').trim();
      const valueRenderOption = (url.searchParams.get('valueRenderOption') || 'FORMATTED_VALUE').trim();
      if (!spreadsheetId) return error('Missing spreadsheetId', 400);
      if (!range) return error('Missing range', 400);

      const clientAccessToken = (url.searchParams.get('accessToken') || '').trim();
      const accessToken = clientAccessToken || await getAccessToken(authResult.uid);

      const apiUrl = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
      );
      apiUrl.searchParams.set('majorDimension', 'ROWS');
      apiUrl.searchParams.set('valueRenderOption', valueRenderOption);

      const res = await fetch(apiUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        const parsed = parseGoogleAuthError(res.status, text);
        if (parsed.needsReauth) {
          return json({ error: 'Google Sheets authorization needs to be refreshed', needsReauth: true, details: parsed.raw }, res.status);
        }
        return error(`Sheets get failed: ${res.status}`, res.status, text);
      }

      const data: any = await res.json().catch(() => ({}));
      return json(
        {
          spreadsheetId,
          range: String(data?.range || range),
          values: Array.isArray(data?.values) ? data.values : [],
        },
        200,
      );
    } catch (e: any) {
      return error(e?.message || 'Sheets get failed', 500);
    }
  },
};
