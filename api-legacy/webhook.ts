import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'ffresearchr',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const adminDb = getFirestore();

async function updateUserSubscription(userId: string, subscribed: boolean, subscriptionId?: string, customerId?: string, subscriptionTier?: 'pro' | 'unlimited') {
  try {
    if (!userId || typeof userId !== 'string' || userId.length < 10) {
      throw new Error('Invalid userId provided');
    }

    const userRef = adminDb.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.warn(`User document ${userId} does not exist, creating with subscription data`);
    }

    if (userDoc.exists && customerId) {
      const existingData = userDoc.data();
      if (existingData?.stripeCustomerId && existingData.stripeCustomerId !== customerId) {
        console.warn(`Customer ID mismatch for user ${userId}: existing=${existingData.stripeCustomerId}, received=${customerId}`);
      }
    }

    const isUnlimited = subscriptionTier === 'unlimited';

    await userRef.set(
      {
        subscribed,
        unlimited: subscribed && isUnlimited,
        subscriptionId: subscriptionId || null,
        stripeCustomerId: customerId || null,
        subscriptionTier: subscriptionTier || 'pro',
        subscriptionUpdatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    console.log(`Updated subscription for user ${userId}: subscribed=${subscribed}, unlimited=${subscribed && isUnlimited}, tier=${subscriptionTier || 'pro'}`);
  } catch (error) {
    console.error('Error updating user subscription:', error);
    throw error;
  }
}

// Credit constants
const PRO_SUBSCRIPTION_CREDITS = 2500;

/**
 * Add credits to a user's account.
 * Called on initial subscription and each billing cycle renewal.
 */
async function addCreditsToUser(userId: string, amount: number) {
  try {
    if (!userId || typeof userId !== 'string' || userId.length < 10) {
      throw new Error('Invalid userId provided for credit addition');
    }

    const userRef = adminDb.collection('users').doc(userId);
    const userDoc = await userRef.get();

    const currentCredits = userDoc.exists ? (userDoc.data()?.credits ?? 0) : 0;
    const newCredits = currentCredits + amount;

    await userRef.set(
      {
        credits: newCredits,
        creditsLastUpdated: new Date().toISOString(),
      },
      { merge: true }
    );

    console.log(`Added ${amount} credits to user ${userId}. New balance: ${newCredits}`);
  } catch (error) {
    console.error('Error adding credits to user:', error);
    throw error;
  }
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response(JSON.stringify({ error: 'No signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(JSON.stringify({ error: `Webhook Error: ${err.message}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const priceType = session.metadata?.priceType || '';
        const subscriptionTier = priceType.includes('unlimited') ? 'unlimited' : 'pro';

        if (userId && session.subscription) {
          await updateUserSubscription(
            userId,
            true,
            session.subscription as string,
            session.customer as string,
            subscriptionTier as 'pro' | 'unlimited'
          );

          // Grant initial subscription credits
          await addCreditsToUser(userId, PRO_SUBSCRIPTION_CREDITS);
          console.log(`Granted ${PRO_SUBSCRIPTION_CREDITS} credits to new subscriber ${userId} (tier: ${subscriptionTier})`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (userId) {
          const isActive = subscription.status === 'active' || subscription.status === 'trialing';
          await updateUserSubscription(userId, isActive, subscription.id, subscription.customer as string);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (userId) {
          await updateUserSubscription(userId, false, subscription.id, subscription.customer as string);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as any).subscription;

        // Only grant credits for subscription renewals, not the initial invoice
        // The initial invoice billing_reason is 'subscription_create'
        // Renewal invoices have billing_reason 'subscription_cycle'
        const billingReason = (invoice as any).billing_reason;

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);
          const userId = subscription.metadata?.userId;

          if (userId) {
            await updateUserSubscription(userId, true, subscription.id, subscription.customer as string);

            // Grant credits on renewal (subscription_cycle) - initial is handled by checkout.session.completed
            if (billingReason === 'subscription_cycle') {
              await addCreditsToUser(userId, PRO_SUBSCRIPTION_CREDITS);
              console.log(`Granted ${PRO_SUBSCRIPTION_CREDITS} renewal credits to user ${userId}`);
            }
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as any).subscription;
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);
          const userId = subscription.metadata?.userId;

          if (userId) {
            await updateUserSubscription(userId, false, subscription.id, subscription.customer as string);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  fetch: POST,
};
