import { requireAuth } from './_auth.js';

type StartRequestBody = {
  input?: string;
  agent?: string;
  stream?: boolean;
};

type StartResponseBody = {
  interactionId: string;
};

type PollResponseBody = {
  status: string;
  outputText?: string;
  error?: any;
};

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const endpointForCreate = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const normalizeInteractionId = (value: string): string => {
  const raw = (value || '').toString().trim();
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
};

const buildGetEndpoint = (id: string) => `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(normalizeInteractionId(id))}`;

export default {
  async fetch(request: Request): Promise<Response> {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    if (!apiKey) {
      return error('Missing GEMINI_API_KEY or API_KEY environment variable.', 500);
    }

    if (request.method === 'POST') {
      try {
        const body = (await request.json()) as StartRequestBody;
        const input = (body.input || '').toString().trim();
        if (!input) return error('Missing input', 400);

        const agent = (body.agent || 'deep-research-pro-preview-12-2025').toString().trim();
        const streamMode = body.stream === true;

        // If streaming mode, use SSE
        if (streamMode) {
          const res = await fetch(`${endpointForCreate}?alt=sse`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              input,
              agent,
              background: true,
              store: true,
              stream: true,
              agent_config: {
                type: 'deep-research',
                thinking_summaries: 'auto'
              }
            }),
          });

          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            return error(`Interactions create failed: ${res.status}`, res.status, text);
          }

          // Return SSE stream directly to client
          return new Response(res.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          });
        }

        // Non-streaming mode (original behavior)
        const res = await fetch(endpointForCreate, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            input,
            agent,
            background: true,
            store: true,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          return error(`Interactions create failed: ${res.status}`, res.status, text);
        }

        const created = await res.json();
        const interactionId = normalizeInteractionId((created?.id || created?.name || created?.interaction?.id || '').toString());
        if (!interactionId) {
          return error('Interactions create returned no interaction id', 500, created);
        }

        const payload: StartResponseBody = { interactionId };
        return json(payload, 200);
      } catch (e: any) {
        return error(e?.message || 'Failed to start deep research', 500);
      }
    }

    if (request.method === 'GET') {
      try {
        const url = new URL(request.url);
        const interactionId = normalizeInteractionId((url.searchParams.get('id') || '').trim());
        if (!interactionId) return error('Missing id', 400);

        const res = await fetch(buildGetEndpoint(interactionId), {
          headers: {
            'x-goog-api-key': apiKey,
          },
        });

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          return error(`Interactions get failed: ${res.status}`, res.status, text);
        }

        const interaction = await res.json();
        const status = (interaction?.status || '').toString();

        const outputs = Array.isArray(interaction?.outputs) ? interaction.outputs : [];
        const last = outputs.length ? outputs[outputs.length - 1] : null;
        const outputText = (last?.text || '').toString();

        const payload: PollResponseBody = {
          status: status || 'unknown',
          outputText: outputText || undefined,
          error: interaction?.error,
        };

        return json(payload, 200);
      } catch (e: any) {
        return error(e?.message || 'Failed to poll deep research', 500);
      }
    }

    return error('Method not allowed', 405);
  },
};
