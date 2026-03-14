import * as checkSubscription from '../api-legacy/check-subscription.js';
import * as createCheckoutSessionLegacy from '../api-legacy/create-checkout-session.js';
import * as webhook from '../api-legacy/webhook.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20' as any,
});

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

const errorJson = (message: string, status = 400) => json({ error: message }, status);

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

const LEGACY_ALLOWED: Record<string, LegacyModule> = {
  'check-subscription': checkSubscription as any,
  'subscription-checkout': createCheckoutSessionLegacy as any,
  'webhook': webhook as any,
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url, 'http://localhost');
    const op = (url.searchParams.get('op') || '').trim();
    if (!op) return errorJson('Missing op', 400);

    // Handle legacy modules first (with renamed op for conflict resolution if needed)
    // Note: 'create-checkout-session' in billing.ts will fall through to inline if not in LEGACY_ALLOWED
    if (LEGACY_ALLOWED[op]) {
      try {
        return await callLegacyModule(LEGACY_ALLOWED[op], request);
      } catch (e: any) {
        return errorJson(e?.message || 'Internal error', 500);
      }
    }

    try {
      // INLINE HANDLERS from stripe.ts
      if (op === 'create-account' && request.method === 'POST') {
        const body = await request.json();
        const { email, country = 'US' } = body;
        if (!email) return errorJson('Email is required', 400);

        const account = await stripe.accounts.create({
          type: 'express',
          country,
          email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });
        return json({
          accountId: account.id,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
        });
      }

      if (op === 'create-account-link' && request.method === 'POST') {
        const body = await request.json();
        const { accountId, returnUrl, refreshUrl } = body;
        if (!accountId) return errorJson('accountId is required', 400);

        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: refreshUrl || `${url.origin}/stripe/refresh`,
          return_url: returnUrl || `${url.origin}/stripe/return`,
          type: 'account_onboarding',
        });
        return json({ url: accountLink.url });
      }

      if (op === 'account-status' && request.method === 'GET') {
        const accountId = url.searchParams.get('accountId');
        if (!accountId) return errorJson('accountId is required', 400);
        const account = await stripe.accounts.retrieve(accountId);
        return json({
          id: account.id,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          requirements: account.requirements,
        });
      }

      if (op === 'create-product' && request.method === 'POST') {
        const body = await request.json();
        const { accountId, name, description, price, currency = 'usd', images } = body;
        if (!accountId || !name || !price) return errorJson('accountId, name, and price are required', 400);

        const productParams: Stripe.ProductCreateParams = { name, description: description || undefined };
        if (images && Array.isArray(images) && images.length > 0) productParams.images = images;

        const product = await stripe.products.create(productParams, { stripeAccount: accountId });
        const priceObj = await stripe.prices.create({
          product: product.id,
          unit_amount: Math.round(price * 100),
          currency,
        }, { stripeAccount: accountId });

        return json({
          id: product.id,
          name: product.name,
          description: product.description,
          priceId: priceObj.id,
          unitAmount: priceObj.unit_amount,
          currency: priceObj.currency,
          images: product.images,
        });
      }

      if (op === 'list-products' && request.method === 'GET') {
        const accountId = url.searchParams.get('accountId');
        if (!accountId) return errorJson('accountId is required', 400);
        const prices = await stripe.prices.list({ active: true, expand: ['data.product'], limit: 100 }, { stripeAccount: accountId });
        const products = prices.data.map((price) => {
          const product = price.product as Stripe.Product;
          return {
            id: product.id,
            name: product.name,
            description: product.description,
            priceId: price.id,
            unitAmount: price.unit_amount,
            currency: price.currency,
            createdAt: product.created,
            images: product.images,
          };
        });
        return json({ products });
      }

      if (op === 'create-payment-link' && request.method === 'POST') {
        const body = await request.json();
        const { accountId, priceId, quantity = 1, customFields, collectBillingAddress, collectPhone, automaticTax, afterCompletionMessage, afterCompletionRedirectUrl, quantityOptions } = body;
        if (!accountId || !priceId) return errorJson('accountId and priceId are required', 400);

        const params: Stripe.PaymentLinkCreateParams = {
          line_items: [{
            price: priceId,
            quantity,
            ...(quantityOptions?.enabled && { adjustable_quantity: { enabled: true, minimum: quantityOptions.minimum, maximum: quantityOptions.maximum } }),
          }],
        };
        if (customFields?.length) params.custom_fields = customFields.map((f: any) => ({ key: f.key, label: { type: 'custom', custom: f.label }, type: f.type }));
        if (collectBillingAddress) params.billing_address_collection = 'required';
        if (collectPhone) params.phone_number_collection = { enabled: true };
        if (automaticTax) params.automatic_tax = { enabled: true };
        if (afterCompletionMessage) params.after_completion = { type: 'hosted_confirmation', hosted_confirmation: { custom_message: afterCompletionMessage } };
        else if (afterCompletionRedirectUrl) params.after_completion = { type: 'redirect', redirect: { url: afterCompletionRedirectUrl } };

        const paymentLink = await stripe.paymentLinks.create(params, { stripeAccount: accountId });
        return json({ id: paymentLink.id, url: paymentLink.url, active: paymentLink.active });
      }

      if (op === 'create-checkout-session' && request.method === 'POST') {
        const clonedRequest = request.clone();
        const body = await request.json();
        const { accountId, priceId, quantity = 1, successUrl, cancelUrl, brandingSettings } = body;

        // If it looks like a subscription (no accountId or specific fields), try legacy
        if (!accountId && body.priceType) {
          return await callLegacyModule(createCheckoutSessionLegacy as any, clonedRequest);
        }

        if (!accountId || !priceId || !successUrl) return errorJson('accountId, priceId, and successUrl are required', 400);

        const sessionOptions: any = {
          mode: 'payment',
          line_items: [{ price: priceId, quantity }],
          success_url: successUrl,
          cancel_url: cancelUrl || successUrl,
        };
        if (brandingSettings) sessionOptions.branding_settings = brandingSettings;

        const session = await stripe.checkout.sessions.create(sessionOptions, { stripeAccount: accountId });
        return json({ id: session.id, url: session.url, status: session.status });
      }

      if (op === 'delete-product' && request.method === 'DELETE') {
        const body = await request.json();
        const { accountId, productId, priceId } = body;
        if (!accountId || !productId) return errorJson('accountId and productId are required', 400);

        if (priceId) await stripe.prices.update(priceId, { active: false }, { stripeAccount: accountId });
        const deleted = await stripe.products.del(productId, { stripeAccount: accountId });
        return json({ id: deleted.id, deleted: deleted.deleted });
      }

      if (op === 'list-orders' && request.method === 'GET') {
        const accountId = url.searchParams.get('accountId');
        const priceId = url.searchParams.get('priceId');
        if (!accountId) return errorJson('accountId is required', 400);

        const sessions = await stripe.checkout.sessions.list({ limit: 100, expand: ['data.line_items', 'data.customer_details'] }, { stripeAccount: accountId });
        const orders = sessions.data
          .filter((s: any) => s.payment_status === 'paid' && s.status === 'complete' && (!priceId || s.line_items?.data.some((i: any) => i.price?.id === priceId)))
          .map((s: any) => ({
            id: s.id,
            customerEmail: s.customer_details?.email || s.customer_email,
            customerName: s.customer_details?.name,
            amount: s.amount_total,
            currency: s.currency,
            status: s.status,
            paymentStatus: s.payment_status,
            createdAt: s.created,
            lineItems: s.line_items?.data.map((i: any) => ({ description: i.description, quantity: i.quantity, amount: i.amount_total, priceId: i.price?.id }))
          }));
        return json({ orders });
      }

      return errorJson('Invalid operation', 400);
    } catch (e: any) {
      console.error('[Billing API Error]', e);
      return errorJson(e?.message || 'Internal server error', 500);
    }
  },
};
