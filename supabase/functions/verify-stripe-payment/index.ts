import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user) throw new Error("User not authenticated");

    const { session_id } = await req.json();
    if (!session_id) throw new Error("Missing session_id");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Check Stripe session status
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") {
      return json({ status: "unpaid", message: "Payment not completed" });
    }

    const meta = session.metadata || {};

    // Check if already processed
    const { data: txn } = await serviceClient
      .from("payment_transactions")
      .select("*")
      .eq("stripe_payment_intent_id", session_id)
      .single();

    if (!txn) throw new Error("Transaction not found");
    if (txn.status === "succeeded") {
      return json({ status: "already_processed", message: "Payment already processed" });
    }

    // Mark succeeded
    await serviceClient
      .from("payment_transactions")
      .update({ status: "succeeded" })
      .eq("id", txn.id);

    const txnUserId = txn.user_id;

    // Get package
    const { data: pkg } = await serviceClient
      .from("credit_packages")
      .select("*")
      .eq("id", txn.package_id)
      .single();
    if (!pkg) throw new Error("Package not found");

    // Increment coupon usage
    if (txn.coupon_id) {
      const { data: coupon } = await serviceClient
        .from("coupons")
        .select("usage_count")
        .eq("id", txn.coupon_id)
        .single();
      if (coupon) {
        await serviceClient
          .from("coupons")
          .update({ usage_count: coupon.usage_count + 1 })
          .eq("id", txn.coupon_id);
      }
    }

    // Attribution
    if (txn.influencer_id) {
      const { data: existingAttr } = await serviceClient
        .from("user_attributions")
        .select("id")
        .eq("user_id", txnUserId)
        .single();
      if (!existingAttr) {
        await serviceClient.from("user_attributions").insert({
          user_id: txnUserId,
          influencer_id: txn.influencer_id,
          coupon_id: txn.coupon_id,
        });
      }
    }

    // Subscription handling
    if (pkg.billing_type === "subscription") {
      const interval = txn.billing_type === "yearly" ? 365 : 30;
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + interval);

      const { data: existingSub } = await serviceClient
        .from("subscriptions")
        .select("*")
        .eq("user_id", txnUserId)
        .eq("is_active", true)
        .single();

      if (existingSub) {
        const currentExpiry = new Date(existingSub.expiry_date);
        const newExpiry = currentExpiry > new Date()
          ? new Date(currentExpiry.getTime() + interval * 86400000)
          : expiryDate;
        await serviceClient
          .from("subscriptions")
          .update({
            package_id: pkg.id,
            billing_type: txn.billing_type,
            expiry_date: newExpiry.toISOString(),
            template_tier: pkg.template_tier,
          })
          .eq("id", existingSub.id);
      } else {
        await serviceClient.from("subscriptions").insert({
          user_id: txnUserId,
          package_id: pkg.id,
          billing_type: txn.billing_type,
          expiry_date: expiryDate.toISOString(),
          template_tier: pkg.template_tier,
        });
      }
    }

    // Segmented credits
    const { data: wallet } = await serviceClient
      .from("user_credit_wallets")
      .select("*")
      .eq("user_id", txnUserId)
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
        .eq("user_id", txnUserId);
    } else {
      await serviceClient.from("user_credit_wallets").insert({
        user_id: txnUserId,
        invoice_remaining: pkg.invoice_credits || 0,
        estimate_remaining: pkg.estimate_credits || 0,
        ai_estimate_remaining: pkg.ai_estimate_credits || 0,
        invoice_unlimited: pkg.invoice_unlimited || false,
        estimate_unlimited: pkg.estimate_unlimited || false,
        ai_estimate_unlimited: pkg.ai_estimate_unlimited || false,
      });
    }

    // Legacy credits
    const totalCredits = (pkg.invoice_credits || 0) + (pkg.estimate_credits || 0) + (pkg.ai_estimate_credits || 0) + (pkg.credit_amount || 0);
    const { data: currentCredits } = await serviceClient
      .from("user_credits")
      .select("balance")
      .eq("user_id", txnUserId)
      .single();
    await serviceClient
      .from("user_credits")
      .update({ balance: (currentCredits?.balance ?? 0) + totalCredits })
      .eq("user_id", txnUserId);

    // Sale record
    const { data: sale } = await serviceClient.from("sales").insert({
      total_amount: txn.original_price || pkg.price,
      discount_amount: txn.discount_amount || 0,
      final_amount: txn.amount,
      coupon_id: txn.coupon_id || null,
      customer_user_id: txnUserId,
    }).select().single();

    // Credit transaction
    await serviceClient.from("credit_transactions").insert({
      user_id: txnUserId,
      package_id: pkg.id,
      transaction_type: "purchase",
      credits_change: totalCredits,
      amount_paid: txn.amount,
      discount_applied: txn.discount_amount || 0,
      coupon_id: txn.coupon_id || null,
    });

    // Commission
    if (sale && txn.influencer_id) {
      const { data: settings } = await serviceClient
        .from("global_settings")
        .select("*")
        .single();

      if (settings) {
        const { data: existingCommission } = await serviceClient
          .from("commissions")
          .select("id")
          .eq("sale_id", sale.id)
          .single();

        if (!existingCommission) {
          const finalPaid = Number(txn.amount);
          const inflPercent = Number(settings.influencer_commission_percent);
          const mgrPercent = Number(settings.manager_commission_percent);
          const influencerAmount = Math.round((finalPaid * inflPercent) / 100 * 100) / 100;
          const managerAmount = txn.manager_id
            ? Math.round((finalPaid * mgrPercent) / 100 * 100) / 100
            : 0;
          const unlockDate = new Date();
          unlockDate.setDate(unlockDate.getDate() + settings.lock_period_days);

          await serviceClient.from("commissions").insert({
            sale_id: sale.id,
            influencer_id: txn.influencer_id,
            manager_id: txn.manager_id || null,
            influencer_amount: influencerAmount,
            manager_amount: managerAmount,
            status: "locked",
            unlock_date: unlockDate.toISOString(),
          });
        }
      }
    }

    return json({
      status: "succeeded",
      credits_added: totalCredits,
      package_name: pkg.name,
      final_price: txn.amount,
      original_price: txn.original_price,
      discount_amount: txn.discount_amount,
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});
