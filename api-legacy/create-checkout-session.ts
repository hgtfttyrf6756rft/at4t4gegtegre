import Stripe from 'stripe';
import { requireAuth } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PRICE_IDS = {
  monthly: process.env.STRIPE_MONTHLY_PRICE_ID || 'price_1SmzYXDktew9heHO1tOLcbfw',
  annual: process.env.STRIPE_ANNUAL_PRICE_ID || 'price_1SmzZQDktew9heHOahllP7Lw',
  unlimited_monthly: process.env.STRIPE_UNLIMITED_MONTHLY_PRICE_ID || 'price_1SmzeiDktew9heHOT43eqrsy',
  unlimited_annual: process.env.STRIPE_UNLIMITED_ANNUAL_PRICE_ID || 'price_1SmzfiDktew9heHOec1oECUR',
};

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const body = await request.json();
    const { priceType, userId, userEmail, successUrl, cancelUrl } = body;

    if (!priceType || !userId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (authResult.uid !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized: userId mismatch' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const priceId = PRICE_IDS[priceType as keyof typeof PRICE_IDS] || PRICE_IDS.monthly;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-app.vercel.app';
    const validatedSuccessUrl = (successUrl && isValidUrl(successUrl)) ? successUrl : `${appUrl}/?subscription=success`;
    const validatedCancelUrl = (cancelUrl && isValidUrl(cancelUrl)) ? cancelUrl : `${appUrl}/`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: validatedSuccessUrl,
      cancel_url: validatedCancelUrl,
      customer_email: userEmail,
      metadata: {
        userId,
        priceType,
      },
      subscription_data: {
        metadata: {
          userId,
        },
      },
    });

    return new Response(JSON.stringify({ sessionId: session.id, url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  fetch: POST,
};
