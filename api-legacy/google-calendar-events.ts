import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

type CalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  status?: string;
  conferenceData?: any;
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
  const ref = db.doc(`users/${uid}/integrations/googleCalendar`);
  const snap = await ref.get();
  const refreshToken = String(snap.data()?.refreshToken || '');
  if (!refreshToken) {
    throw new Error('Google Calendar not connected');
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
      const calendarId = (url.searchParams.get('calendarId') || 'primary').trim() || 'primary';
      const timeMin = (url.searchParams.get('timeMin') || '').trim();
      const timeMax = (url.searchParams.get('timeMax') || '').trim();

      if (!timeMin || !timeMax) {
        return error('Missing timeMin or timeMax', 400);
      }

      const accessToken = await getAccessToken(authResult.uid);

      const apiUrl = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      );
      apiUrl.searchParams.set('timeMin', timeMin);
      apiUrl.searchParams.set('timeMax', timeMax);
      apiUrl.searchParams.set('singleEvents', 'true');
      apiUrl.searchParams.set('orderBy', 'startTime');
      apiUrl.searchParams.set('maxResults', '250');

      const res = await fetch(apiUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        const parsed = parseGoogleAuthError(res.status, text);
        if (parsed.needsReauth) {
          return json({ error: 'Google Calendar authorization needs to be refreshed', needsReauth: true, details: parsed.raw }, res.status);
        }
        return error(`Calendar events list failed: ${res.status}`, res.status, text);
      }

      const data: any = await res.json().catch(() => ({}));
      const items: CalendarEvent[] = Array.isArray(data?.items) ? data.items : [];

      return json({ events: items }, 200);
    } catch (e: any) {
      return error(e?.message || 'Failed to list calendar events', 500);
    }
  },
};
