import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

type DriveFileItem = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

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
      const qRaw = (url.searchParams.get('q') || '').trim();
      const mimeType = (url.searchParams.get('mimeType') || '').trim();
      const pageToken = (url.searchParams.get('pageToken') || '').trim();
      const pageSize = Math.max(1, Math.min(50, parseInt(url.searchParams.get('pageSize') || '25', 10) || 25));

      const clientAccessToken = (url.searchParams.get('accessToken') || '').trim();
      const accessToken = clientAccessToken || await getAccessToken(authResult.uid);

      const qParts: string[] = ['trashed=false'];
      if (mimeType) {
        const safeMime = mimeType.replace(/'/g, "\\'");
        qParts.push(`mimeType='${safeMime}'`);
      }
      if (qRaw) {
        const safe = qRaw.replace(/'/g, "\\'");
        qParts.push(`name contains '${safe}'`);
      }

      const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
      driveUrl.searchParams.set('pageSize', String(pageSize));
      driveUrl.searchParams.set('q', qParts.join(' and '));
      driveUrl.searchParams.set(
        'fields',
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,iconLink,thumbnailLink,webViewLink)'
      );
      driveUrl.searchParams.set('supportsAllDrives', 'true');
      driveUrl.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) driveUrl.searchParams.set('pageToken', pageToken);

      const res = await fetch(driveUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return error(`Drive list failed: ${res.status}`, res.status, text);
      }

      const data: any = await res.json().catch(() => ({}));
      const files: DriveFileItem[] = Array.isArray(data?.files) ? data.files : [];
      return json({ files, nextPageToken: data?.nextPageToken || null }, 200);
    } catch (e: any) {
      return error(e?.message || 'Drive list failed', 500);
    }
  },
};
