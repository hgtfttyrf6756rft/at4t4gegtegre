import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';
import { put } from '@vercel/blob';

type RequestBody = {
  projectId?: string;
  fileId?: string;
  accessToken?: string;
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const sanitizePathSegment = (value: string) =>
  (value || '')
    .toString()
    .replace(/[^a-zA-Z0-9._\-\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140) || 'file';

const baseExtForMime = (mimeType: string): string => {
  if (mimeType === 'text/plain') return '.txt';
  if (mimeType === 'text/csv') return '.csv';
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/png') return '.png';
  return '';
};

const exportConfigForGoogleMime = (googleMime: string): { exportMime: string; ext: string } | null => {
  if (googleMime === 'application/vnd.google-apps.document') {
    return { exportMime: 'text/plain', ext: '.txt' };
  }
  if (googleMime === 'application/vnd.google-apps.spreadsheet') {
    return { exportMime: 'text/csv', ext: '.csv' };
  }
  if (googleMime === 'application/vnd.google-apps.presentation') {
    return { exportMime: 'application/pdf', ext: '.pdf' };
  }
  if (googleMime === 'application/vnd.google-apps.drawing') {
    return { exportMime: 'image/png', ext: '.png' };
  }
  return null;
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
    if (request.method !== 'POST') {
      return error('Method not allowed', 405);
    }

    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return error('Invalid JSON body', 400);
    }

    const projectId = (body.projectId || '').toString().trim();
    const fileId = (body.fileId || '').toString().trim();
    const clientAccessToken = (body.accessToken || '').toString().trim(); // New field

    if (!projectId) return error('Missing projectId', 400);
    if (!fileId) return error('Missing fileId', 400);

    try {
      // Use client token if provided (preferred for Picker flow), else fallback to stored refresh token
      const accessToken = clientAccessToken || await getAccessToken(authResult.uid);

      const metaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
      metaUrl.searchParams.set('fields', 'id,name,mimeType,size,modifiedTime,webViewLink');
      metaUrl.searchParams.set('supportsAllDrives', 'true');

      const metaRes = await fetch(metaUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!metaRes.ok) {
        const text = await metaRes.text().catch(() => metaRes.statusText);
        return error(`Drive get failed: ${metaRes.status}`, metaRes.status, text);
      }

      const meta: any = await metaRes.json().catch(() => ({}));
      const originalName = String(meta?.name || 'file');
      const mimeType = String(meta?.mimeType || 'application/octet-stream');

      const exportCfg = exportConfigForGoogleMime(mimeType);
      let downloadUrl: string;
      let outMimeType: string;
      let outExt: string;

      if (exportCfg) {
        const exportUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export`);
        exportUrl.searchParams.set('mimeType', exportCfg.exportMime);
        downloadUrl = exportUrl.toString();
        outMimeType = exportCfg.exportMime;
        outExt = exportCfg.ext;
      } else {
        const dlUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
        dlUrl.searchParams.set('alt', 'media');
        dlUrl.searchParams.set('supportsAllDrives', 'true');
        downloadUrl = dlUrl.toString();
        outMimeType = mimeType;
        outExt = baseExtForMime(outMimeType);
      }

      const safeBase = sanitizePathSegment(originalName.replace(/\.[^.]+$/, ''));
      const filename = safeBase.endsWith(outExt) ? safeBase : `${safeBase}${outExt}`;

      const fileRes = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!fileRes.ok || !fileRes.body) {
        const text = await fileRes.text().catch(() => fileRes.statusText);
        return error(`Drive download failed: ${fileRes.status}`, fileRes.status, text);
      }

      const blob = await put(`projects/${projectId}/drive/${filename}`, fileRes.body, {
        access: 'public',
        addRandomSuffix: true,
        contentType: outMimeType,
      });

      const kbFileId =
        typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `kb-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const knowledgeBaseFile = {
        id: kbFileId,
        name: filename,
        type: outMimeType,
        size: Number(meta?.size || 0) || 0,
        url: blob.url,
        storagePath: blob.pathname,
        uploadedAt: Date.now(),
      };

      return json({ knowledgeBaseFile }, 200);
    } catch (e: any) {
      return error(e?.message || 'Drive import failed', 500);
    }
  },
};
