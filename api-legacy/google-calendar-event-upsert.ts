import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

type RequestBody = {
  calendarId?: string;
  eventId?: string;
  summary?: string;
  description?: string;
  startMs?: number;
  endMs?: number;
  addMeet?: boolean;
  timeZone?: string;
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

const extractMeetLink = (event: any): string | null => {
  const hangoutLink = typeof event?.hangoutLink === 'string' ? event.hangoutLink : '';
  if (hangoutLink) return hangoutLink;

  const entryPoints = Array.isArray(event?.conferenceData?.entryPoints)
    ? event.conferenceData.entryPoints
    : [];

  for (const ep of entryPoints) {
    const uri = typeof ep?.uri === 'string' ? ep.uri : '';
    if (uri && (uri.includes('meet.google.com') || uri.startsWith('https://'))) {
      return uri;
    }
  }

  return null;
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

    try {
      const calendarId = String(body?.calendarId || 'primary').trim() || 'primary';
      const eventId = String(body?.eventId || '').trim();
      const summary = String(body?.summary || '').trim();
      const description = typeof body?.description === 'string' ? body.description : '';
      const startMs = Number(body?.startMs || 0);
      const endMs = Number(body?.endMs || 0);
      const addMeet = body?.addMeet !== false;
      const timeZone = typeof body?.timeZone === 'string' && body.timeZone ? body.timeZone : undefined;

      if (!summary) return error('Missing summary', 400);
      if (!startMs || !endMs) return error('Missing startMs or endMs', 400);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return error('Invalid startMs/endMs', 400);
      }

      const accessToken = await getAccessToken(authResult.uid);

      const resource: any = {
        summary,
        description,
        start: { dateTime: new Date(startMs).toISOString(), timeZone },
        end: { dateTime: new Date(endMs).toISOString(), timeZone },
      };

      // Meet link creation requires conferenceDataVersion=1.
      // We request conference creation each time when addMeet is true.
      if (addMeet) {
        resource.conferenceData = {
          createRequest: { requestId: `req-${Date.now()}-${Math.random().toString(16).slice(2)}` },
        };
      }

      let apiUrl: URL;
      let method: string;

      if (eventId) {
        apiUrl = new URL(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
        );
        method = 'PATCH';
      } else {
        apiUrl = new URL(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
        );
        method = 'POST';
      }

      apiUrl.searchParams.set('conferenceDataVersion', '1');

      const res = await fetch(apiUrl.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(resource),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        const parsed = parseGoogleAuthError(res.status, text);
        if (parsed.needsReauth) {
          return json({ error: 'Google Calendar authorization needs to be refreshed', needsReauth: true, details: parsed.raw }, res.status);
        }
        return error(`Calendar event upsert failed: ${res.status}`, res.status, text);
      }

      const data: any = await res.json().catch(() => ({}));
      const meetLink = extractMeetLink(data);

      return json(
        {
          eventId: String(data?.id || ''),
          htmlLink: data?.htmlLink,
          meetLink,
          event: data,
        },
        200,
      );
    } catch (e: any) {
      return error(e?.message || 'Failed to upsert calendar event', 500);
    }
  },
};
