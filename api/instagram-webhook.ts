import crypto from 'node:crypto';

const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const getAppSecret = () =>
  (process.env.FACEBOOK_APP_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.INSTAGRAM_APP_SECRET ||
    process.env.VITE_FACEBOOK_APP_SECRET ||
    '').toString();

const getVerifyToken = () =>
  (process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ||
    process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN ||
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    '').toString();

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url, 'http://localhost');

  // Verification request from Meta
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const challenge = url.searchParams.get('hub.challenge') || '';
    const verifyToken = url.searchParams.get('hub.verify_token') || '';

    console.log('[IG Webhook] Verification request:', { mode, hasChallenge: !!challenge });

    const expectedToken = getVerifyToken();
    if (!expectedToken) {
      console.error('[IG Webhook] Missing INSTAGRAM_WEBHOOK_VERIFY_TOKEN in environment');
      return new Response('Verify token not configured', {
        status: 500,
        headers: TEXT_HEADERS,
      });
    }

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      // Echo the challenge back to Meta
      return new Response(challenge, {
        status: 200,
        headers: TEXT_HEADERS,
      });
    }

    console.warn('[IG Webhook] Verification failed', {
      mode,
      verifyToken,
    });

    return new Response('Verification failed', {
      status: 403,
      headers: TEXT_HEADERS,
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const appSecret = getAppSecret();
  const signatureHeader = request.headers.get('x-hub-signature-256') || '';

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (e: any) {
    console.error('[IG Webhook] Failed to read body:', e?.message || e);
    return json({ error: 'Invalid body' }, 400);
  }

  // Optionally validate payload signature when app secret is configured
  if (appSecret && signatureHeader.startsWith('sha256=')) {
    try {
      const theirSig = signatureHeader.slice('sha256='.length);
      const hmac = crypto.createHmac('sha256', appSecret);
      hmac.update(rawBody, 'utf8');
      const ourSig = hmac.digest('hex');

      const valid =
        theirSig.length === ourSig.length &&
        crypto.timingSafeEqual(Buffer.from(theirSig, 'hex'), Buffer.from(ourSig, 'hex'));

      if (!valid) {
        console.warn('[IG Webhook] Signature validation failed');
        return json({ error: 'Invalid signature' }, 401);
      }
    } catch (e: any) {
      console.error('[IG Webhook] Error validating signature:', e?.message || e);
      return json({ error: 'Signature validation error' }, 400);
    }
  } else if (!appSecret) {
    console.warn('[IG Webhook] App secret not configured, skipping signature validation');
  } else {
    console.warn('[IG Webhook] Missing or malformed X-Hub-Signature-256 header');
  }

  let payload: any = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // Keep raw body for debugging if JSON parse fails
    payload = { raw: rawBody };
  }

  // For now, just log the payload so it can be inspected in logs / dashboard.
  console.log('[IG Webhook] Event payload:', JSON.stringify(payload, null, 2));

  // Always acknowledge quickly so Meta does not retry excessively.
  return json({ received: true }, 200);
}


