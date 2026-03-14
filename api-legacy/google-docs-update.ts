import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

type RequestBody = {
  documentId?: string;
  text?: string;
};

type InlineImageToken = {
  uri: string;
  widthPt?: number;
  heightPt?: number;
};

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

const getBodyEndIndex = async (accessToken: string, documentId: string): Promise<number> => {
  const apiUrl = new URL(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
  apiUrl.searchParams.set('fields', 'body(content(endIndex))');

  const res = await fetch(apiUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    const parsed = parseGoogleAuthError(res.status, text);
    if (parsed.needsReauth) {
      const err: any = new Error('needsReauth');
      err.needsReauth = true;
      err.details = parsed.raw;
      throw err;
    }
    throw new Error(`Docs get failed: ${res.status} ${text || ''}`.trim());
  }

  const data: any = await res.json().catch(() => ({}));
  const elements = Array.isArray(data?.body?.content) ? data.body.content : [];
  let endIndex = 1;
  for (const el of elements) {
    if (typeof el?.endIndex === 'number') endIndex = Math.max(endIndex, el.endIndex);
  }
  return endIndex;
};

const INLINE_IMAGE_TOKEN_RE = /\[\[IMAGE:([^\]]+)\]\]/g;

const pxToPt = (px: number): number => {
  // 96 DPI CSS px -> points.
  return Math.max(1, px * 0.75);
};

const parseInlineImageToken = (raw: string): InlineImageToken | null => {
  const parts = String(raw || '')
    .split('|')
    .map(p => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const uri = parts[0];
  if (!uri || uri.startsWith('blob:') || uri.startsWith('data:')) {
    return null;
  }
  if (!/^https?:\/\//i.test(uri)) {
    return null;
  }

  const out: InlineImageToken = { uri };
  for (const part of parts.slice(1)) {
    const lower = part.toLowerCase();
    if (lower.startsWith('w=')) {
      const n = Number(lower.slice(2));
      if (Number.isFinite(n) && n > 0) out.widthPt = pxToPt(n);
    }
    if (lower.startsWith('h=')) {
      const n = Number(lower.slice(2));
      if (Number.isFinite(n) && n > 0) out.heightPt = pxToPt(n);
    }
  }
  return out;
};

const buildGoogleDocsRequestsFromText = (text: string): any[] => {
  const requests: any[] = [];

  let cursorIndex = 1;
  const insertTextAt = (t: string) => {
    if (!t) return;
    requests.push({
      insertText: {
        text: t,
        location: { index: cursorIndex },
      },
    });
    cursorIndex += t.length;
  };

  const insertImageAt = (token: InlineImageToken) => {
    const req: any = {
      insertInlineImage: {
        uri: token.uri,
        location: { index: cursorIndex },
      },
    };

    if (token.widthPt || token.heightPt) {
      req.insertInlineImage.objectSize = {
        width: token.widthPt
          ? { magnitude: token.widthPt, unit: 'PT' }
          : undefined,
        height: token.heightPt
          ? { magnitude: token.heightPt, unit: 'PT' }
          : undefined,
      };
    }

    requests.push(req);
    // Inline objects take up a single index position.
    cursorIndex += 1;
  };

  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_IMAGE_TOKEN_RE.exec(text)) !== null) {
    const before = text.slice(last, match.index);
    insertTextAt(before);

    const token = parseInlineImageToken(match[1]);
    if (!token) {
      // If invalid, keep the literal token text.
      insertTextAt(match[0]);
      last = match.index + match[0].length;
      continue;
    }

    insertImageAt(token);
    // Ensure images end a line unless the author explicitly put content after.
    insertTextAt('\n');

    last = match.index + match[0].length;
  }

  insertTextAt(text.slice(last));

  return requests;
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

    const documentId = (body.documentId || '').toString().trim();
    const rawText = (body.text ?? '').toString();

    if (!documentId) return error('Missing documentId', 400);

    try {
      const url = new URL(request.url);
      const queryToken = url.searchParams.get('accessToken');

      const accessToken = queryToken || (await getAccessToken(authResult.uid));

      let text = rawText.replace(/\r\n/g, '\n');
      if (!text.endsWith('\n')) text += '\n';

      const endIndex = await getBodyEndIndex(accessToken, documentId);
      const deleteEnd = Math.max(1, endIndex - 1);

      const batchUrl = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`;

      const requests: any[] = [];
      if (deleteEnd > 1) {
        requests.push({
          deleteContentRange: {
            range: {
              startIndex: 1,
              endIndex: deleteEnd,
            },
          },
        });
      }

      if (text.trim().length) {
        if (INLINE_IMAGE_TOKEN_RE.test(text)) {
          // Reset stateful regex cursor after test() call.
          INLINE_IMAGE_TOKEN_RE.lastIndex = 0;
          requests.push(...buildGoogleDocsRequestsFromText(text));
        } else {
          requests.push({
            insertText: {
              text,
              location: { index: 1 },
            },
          });
        }
      }

      const res = await fetch(batchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      });

      if (!res.ok) {
        const textErr = await res.text().catch(() => res.statusText);
        const parsed = parseGoogleAuthError(res.status, textErr);
        if (parsed.needsReauth) {
          return json({ error: 'Google Docs authorization needs to be refreshed', needsReauth: true, details: parsed.raw }, res.status);
        }
        return error(`Docs update failed: ${res.status}`, res.status, textErr);
      }

      return json({ ok: true }, 200);
    } catch (e: any) {
      if (e?.needsReauth) {
        return json({ error: 'Google Docs authorization needs to be refreshed', needsReauth: true, details: e?.details }, 403);
      }
      return error(e?.message || 'Docs update failed', 500);
    }
  },
};
