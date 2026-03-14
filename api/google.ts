import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';
import * as googleCalendarEventDelete from '../api-legacy/google-calendar-event-delete.js';
import * as googleCalendarEventUpsert from '../api-legacy/google-calendar-event-upsert.js';
import * as googleCalendarEvents from '../api-legacy/google-calendar-events.js';
import * as googleCalendarStatus from '../api-legacy/google-calendar-status.js';
import * as googleDocsGet from '../api-legacy/google-docs-get.js';
import * as googleDocsUpdate from '../api-legacy/google-docs-update.js';
import * as googleDriveAuthUrl from '../api-legacy/google-drive-auth-url.js';
import * as googleCalendarAuthUrl from '../api-legacy/google-calendar-auth-url.js';
import * as googleCalendarExchange from '../api-legacy/google-calendar-exchange.js';
import * as googleDriveExchange from '../api-legacy/google-drive-exchange.js';
import * as googleDriveFiles from '../api-legacy/google-drive-files.js';
import * as googleDriveImport from '../api-legacy/google-drive-import.js';
import * as googleDriveStatus from '../api-legacy/google-drive-status.js';
import * as googleSheetsCreate from '../api-legacy/google-sheets-create.js';
import * as googleSheetsMetadata from '../api-legacy/google-sheets-metadata.js';
import * as googleSheetsValuesClear from '../api-legacy/google-sheets-values-clear.js';
import * as googleSheetsValuesGet from '../api-legacy/google-sheets-values-get.js';
import * as googleSheetsValuesUpdate from '../api-legacy/google-sheets-values-update.js';
import * as youtubeAuthUrl from '../api-legacy/youtube-auth-url.js';
import * as youtubeExchange from '../api-legacy/youtube-exchange.js';
import * as youtubeStatus from '../api-legacy/youtube-status.js';
import * as youtubeUploadInit from '../api-legacy/youtube-upload-init.js';
import * as youtubeSearch from '../api-legacy/youtube-search.js';
import * as autocomplete from '../api-legacy/autocomplete.js';

type LegacyModule = {
  default?: { fetch?: (request: Request) => Promise<Response> | Response } | ((request: Request) => Promise<Response> | Response);
  fetch?: (request: Request) => Promise<Response> | Response;
  GET?: (request: Request) => Promise<Response> | Response;
  POST?: (request: Request) => Promise<Response> | Response;
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400) => json({ error: message }, status);

const callLegacyModule = async (mod: LegacyModule, request: Request): Promise<Response> => {
  const handler =
    (mod?.default as any)?.fetch ||
    (typeof mod?.default === 'function' ? (mod.default as any) : null) ||
    mod?.fetch ||
    (request.method === 'GET' ? mod?.GET : null) ||
    (request.method === 'POST' ? mod?.POST : null);

  if (typeof handler !== 'function') {
    throw new Error('Legacy handler missing');
  }

  return await handler(request);
};

const ALLOWED: Record<string, LegacyModule> = {
  'google-calendar-event-delete': googleCalendarEventDelete,
  'google-calendar-event-upsert': googleCalendarEventUpsert,
  'google-calendar-events': googleCalendarEvents,
  'google-calendar-status': googleCalendarStatus,
  'google-docs-get': googleDocsGet,
  'google-docs-update': googleDocsUpdate,
  'google-calendar-auth-url': googleCalendarAuthUrl,
  'google-calendar-exchange': googleCalendarExchange,
  'google-drive-auth-url': googleDriveAuthUrl,
  'google-drive-exchange': googleDriveExchange,
  'google-drive-files': googleDriveFiles,
  'google-drive-import': googleDriveImport,
  'google-drive-status': googleDriveStatus,
  'google-sheets-create': googleSheetsCreate,
  'google-sheets-metadata': googleSheetsMetadata,
  'google-sheets-values-clear': googleSheetsValuesClear,
  'google-sheets-values-get': googleSheetsValuesGet,
  'google-sheets-values-update': googleSheetsValuesUpdate,
  'youtube-auth-url': youtubeAuthUrl,
  'youtube-exchange': youtubeExchange,
  'youtube-status': youtubeStatus,
  'youtube-upload-init': youtubeUploadInit,
  'youtube-search': youtubeSearch,
  'autocomplete': autocomplete,
  'google-disconnect': {
    default: async (request: Request) => {
      const authResult = await (requireAuth as any)(request);
      if (authResult instanceof Response) return authResult;
      const db = getFirestore();
      // Delete both youtube and googleDrive if they exist
      await db.doc(`users/${authResult.uid}/integrations/youtube`).delete();
      await db.doc(`users/${authResult.uid}/integrations/googleDrive`).delete();
      return json({ success: true });
    }
  }
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url, 'http://localhost');
    const op = (url.searchParams.get('op') || '').trim();
    if (!op) return error('Missing op', 400);

    const mod = ALLOWED[op];
    if (!mod) return error('Not found', 404);

    try {
      return await callLegacyModule(mod, request);
    } catch (e: any) {
      console.error('[Google API] Error calling legacy module:', e);
      return error(e?.message || 'Internal error', 500);
    }
  },
};
