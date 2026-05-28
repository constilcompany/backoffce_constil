import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function getStripe() {
  return new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.text();
    const stripe = getStripe();

    // Verify webhook signature if secret is configured
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    let event: Stripe.Event;

    if (webhookSecret) {
      const sig = req.headers.get("stripe-signature");
      if (!sig) return json({ error: "Missing signature" }, 400);
      try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
      } catch {
        return json({ error: "Invalid signature" }, 400);
      }
    } else {
      event = JSON.parse(body) as Stripe.Event;
    }

    console.log(`[STRIPE-WEBHOOK] Event: ${event.type}`);

    // === invoice.paid ===
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;

      if (invoice.amount_paid === 0) {
        return json({ received: true, action: "skipped_trial_invoice" });
      }

      const subscriptionId = typeof invoice.subscription === "string"
        ? invoice.subscription
        : (invoice.subscription as any)?.id;

      if (!subscriptionId) {
        return json({ received: true, action: "no_subscription" });
      }

      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      const meta = stripeSubscription.metadata || {};
      const userId = meta.user_id;
      const packageId = meta.package_id;

      if (!userId || !packageId) {
        return json({ received: true, action: "missing_metadata" });
      }

      const { data: pkg } = await serviceClient
        .from("credit_packages")
        .select("*")
        .eq("id", packageId)
        .single();

      if (!pkg) {
        return json({ received: true, action: "package_not_found" });
      }

      const interval = stripeSubscription.items.data[0]?.plan?.interval === "year" ? 365 : 30;
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + interval);

      const { data: existingSub } = await serviceClient
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .single();

      if (existingSub) {
        await serviceClient
          .from("subscriptions")
          .update({
            is_trial: false,
            status: "active",
            package_id: packageId,
            billing_type: interval === 365 ? "yearly" : "monthly",
            expiry_date: newExpiry.toISOString(),
            template_tier: pkg.template_tier,
          })
          .eq("id", existingSub.id);
      } else {
        await serviceClient.from("subscriptions").insert({
          user_id: userId,
          package_id: packageId,
          billing_type: interval === 365 ? "yearly" : "monthly",
          template_tier: pkg.template_tier,
          is_active: true,
          is_trial: false,
          status: "active",
          start_date: new Date().toISOString(),
          expiry_date: newExpiry.toISOString(),
        });
      }

      // Grant credits
      const { data: wallet } = await serviceClient
        .from("user_credit_wallets")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (wallet) {
        await serviceClient
          .from("user_credit_wallets")
          .update({
            invoice_remaining: wallet.invoice_remaining + (pkg.invoice_credits || 0),
            estimate_remaining: wallet.estimate_remaining + (pkg.estimate_credits || 0),
            ai_estimate_remaining: wallet.ai_estimate_remaining + (pkg.ai_estimate_credits || 0),
            invoice_unlimited: pkg.invoice_unlimited || wallet.invoice_unlimited,
            estimate_unlimited: pkg.estimate_unlimited || wallet.estimate_unlimited,
            ai_estimate_unlimited: pkg.ai_estimate_unlimited || wallet.ai_estimate_unlimited,
          })
          .eq("user_id", userId);
      }

      const amountPaid = invoice.amount_paid / 100;
      await serviceClient.from("payment_transactions").insert({
        user_id: userId,
        package_id: packageId,
        amount: amountPaid,
        original_price: Number(pkg.price),
        currency: invoice.currency || "usd",
        billing_type: interval === 365 ? "yearly" : "monthly",
        stripe_payment_intent_id: typeof invoice.payment_intent === "string"
          ? invoice.payment_intent
          : (invoice.payment_intent as any)?.id || subscriptionId,
        status: "succeeded",
        payment_mode: "stripe",
        metadata: { event_type: "invoice.paid", subscription_id: subscriptionId },
      });

      const totalCredits = (pkg.invoice_credits || 0) + (pkg.estimate_credits || 0) + (pkg.ai_estimate_credits || 0) + (pkg.credit_amount || 0);
      const { data: currentCredits } = await serviceClient
        .from("user_credits")
        .select("balance")
        .eq("user_id", userId)
        .single();
      if (currentCredits) {
        await serviceClient
          .from("user_credits")
          .update({ balance: currentCredits.balance + totalCredits })
          .eq("user_id", userId);
      }

      await serviceClient.from("credit_transactions").insert({
        user_id: userId,
        package_id: packageId,
        transaction_type: "purchase",
        credits_change: totalCredits,
        amount_paid: amountPaid,
      });

      const { data: sale } = await serviceClient.from("sales").insert({
        total_amount: Number(pkg.price),
        discount_amount: 0,
        final_amount: amountPaid,
        customer_user_id: userId,
      }).select().single();

      if (sale) {
        const { data: attribution } = await serviceClient
          .from("user_attributions")
          .select("influencer_id, coupon_id")
          .eq("user_id", userId)
          .single();

        if (attribution?.influencer_id) {
          const { data: settings } = await serviceClient
            .from("global_settings")
            .select("*")
            .single();

          if (settings) {
            const { data: link } = await serviceClient
              .from("manager_influencers")
              .select("manager_id")
              .eq("influencer_id", attribution.influencer_id)
              .single();

            const inflPercent = Number(settings.influencer_commission_percent);
            const mgrPercent = Number(settings.manager_commission_percent);
            const influencerAmount = Math.round((amountPaid * inflPercent) / 100 * 100) / 100;
            const managerAmount = link?.manager_id
              ? Math.round((amountPaid * mgrPercent) / 100 * 100) / 100
              : 0;
            const unlockDate = new Date();
            unlockDate.setDate(unlockDate.getDate() + settings.lock_period_days);

            await serviceClient.from("commissions").insert({
              sale_id: sale.id,
              influencer_id: attribution.influencer_id,
              manager_id: link?.manager_id || null,
              influencer_amount: influencerAmount,
              manager_amount: managerAmount,
              status: "locked",
              unlock_date: unlockDate.toISOString(),
            });
          }
        }
      }

      return json({ received: true, action: "payment_processed" });
    }

    // === customer.subscription.deleted ===
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;

      if (userId) {
        await serviceClient
          .from("subscriptions")
          .update({ is_active: false, status: "cancelled" })
          .eq("user_id", userId)
          .eq("is_active", true);
      }

      return json({ received: true, action: "subscription_cancelled" });
    }

    // === invoice.payment_failed ===
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === "string"
        ? invoice.subscription
        : (invoice.subscription as any)?.id;

      if (subscriptionId) {
        const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
        const userId = stripeSubscription.metadata?.user_id;

        if (userId) {
          await serviceClient
            .from("subscriptions")
            .update({ status: "past_due" })
            .eq("user_id", userId)
            .eq("is_active", true);
        }
      }

      return json({ received: true, action: "payment_failed_noted" });
    }

    return json({ received: true, action: "unhandled" });
  } catch (err) {
    console.error("[STRIPE-WEBHOOK] Error:", (err as Error).message);
    // Never expose internal errors in webhook responses
    return json({ error: "Processing error" }, 500);
  }
});
