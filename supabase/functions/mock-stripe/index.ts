import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function generateMockId(prefix: string) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix + "_mock_";
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function getAuthUserId(req: Request, serviceClient: any) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error } = await anonClient.auth.getClaims(token);
  if (error || !claimsData?.claims) return null;
  return claimsData.claims.sub as string;
}

async function validateCoupon(serviceClient: any, couponCode: string) {
  const { data: coupon } = await serviceClient
    .from("coupons")
    .select("*, profiles!coupons_influencer_id_fkey(user_id, full_name)")
    .eq("code", couponCode.toUpperCase())
    .eq("is_active", true)
    .single();

  if (!coupon) return { valid: false, error: "Invalid coupon code" };
  if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit)
    return { valid: false, error: "Coupon usage limit reached" };
  if (coupon.expiry_date && new Date(coupon.expiry_date) <= new Date())
    return { valid: false, error: "Coupon has expired" };

  // Get manager_id
  let managerId: string | null = null;
  if (coupon.influencer_id) {
    const { data: link } = await serviceClient
      .from("manager_influencers")
      .select("manager_id")
      .eq("influencer_id", coupon.influencer_id)
      .single();
    managerId = link?.manager_id ?? null;
  }

  return {
    valid: true,
    coupon,
    influencer_id: coupon.influencer_id,
    manager_id: managerId,
    discount_percent: Number(coupon.discount_percent),
  };
}

function calculatePricing(price: number, discountPercent: number) {
  const originalPrice = Number(price);
  const discountAmount = Math.round((originalPrice * discountPercent) / 100 * 100) / 100;
  const finalPrice = Math.max(0, Math.round((originalPrice - discountAmount) * 100) / 100);
  return { originalPrice, discountAmount, finalPrice };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/mock-stripe\/?/, "");

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // === GET /validate-coupon?code=XXXX ===
    if (req.method === "GET" && path === "validate-coupon") {
      const code = url.searchParams.get("code");
      if (!code) return json({ error: "Missing code parameter" }, 400);

      const result = await validateCoupon(serviceClient, code);
      if (!result.valid) return json({ valid: false, error: result.error });

      return json({
        valid: true,
        discount_percent: result.discount_percent,
        influencer_name: result.coupon?.profiles?.full_name || null,
        influencer_id: result.influencer_id,
      });
    }

    // === POST /create-payment-intent ===
    if (req.method === "POST" && path === "create-payment-intent") {
      const userId = await getAuthUserId(req, serviceClient);
      if (!userId) return json({ error: "Unauthorized" }, 401);

      const { package_id, billing_type = "one_time", coupon_code } = await req.json();
      if (!package_id) return json({ error: "Missing package_id" }, 400);

      const { data: pkg } = await serviceClient
        .from("credit_packages")
        .select("*")
        .eq("id", package_id)
        .eq("is_active", true)
        .single();
      if (!pkg) return json({ error: "Invalid package" }, 400);

      // Validate coupon ONLY when explicitly provided
      let discountPercent = 0;
      let couponData: any = null;
      let influencerId: string | null = null;
      let managerId: string | null = null;

      if (coupon_code) {
        const result = await validateCoupon(serviceClient, coupon_code);
        if (!result.valid) return json({ error: result.error }, 400);
        discountPercent = result.discount_percent;
        couponData = result.coupon;
        influencerId = result.influencer_id;
        managerId = result.manager_id;
      }

      const { originalPrice, discountAmount, finalPrice } = calculatePricing(pkg.price, discountPercent);

      const paymentIntentId = generateMockId("pi");

      const metadata = {
        user_id: userId,
        package_id: pkg.id,
        coupon_code: couponData?.code || null,
        coupon_id: couponData?.id || null,
        original_price: originalPrice,
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        final_price: finalPrice,
        influencer_id: influencerId,
        manager_id: managerId,
      };

      // Create pending transaction with full metadata
      await serviceClient.from("payment_transactions").insert({
        user_id: userId,
        package_id: pkg.id,
        amount: finalPrice,
        original_price: originalPrice,
        discount_amount: discountAmount,
        coupon_code: couponData?.code || null,
        coupon_id: couponData?.id || null,
        influencer_id: influencerId,
        manager_id: managerId,
        currency: "usd",
        billing_type,
        stripe_payment_intent_id: paymentIntentId,
        status: "pending",
        payment_mode: "mock",
        metadata,
      });

      return json({
        payment_intent_id: paymentIntentId,
        original_price: originalPrice,
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        final_price: finalPrice,
        currency: "usd",
        status: "requires_confirmation",
        client_secret: generateMockId("cs"),
        coupon_code: couponData?.code || null,
        influencer_name: couponData?.profiles?.full_name || null,
        package_name: pkg.name,
      });
    }

    // === POST /confirm-payment ===
    if (req.method === "POST" && path === "confirm-payment") {
      const userId = await getAuthUserId(req, serviceClient);
      if (!userId) return json({ error: "Unauthorized" }, 401);

      const { payment_intent_id, simulate_failure = false } = await req.json();
      if (!payment_intent_id) return json({ error: "Missing payment_intent_id" }, 400);

      const { data: txn } = await serviceClient
        .from("payment_transactions")
        .select("*")
        .eq("stripe_payment_intent_id", payment_intent_id)
        .eq("status", "pending")
        .single();

      if (!txn) return json({ error: "Payment intent not found or already processed" }, 400);

      if (simulate_failure) {
        await serviceClient
          .from("payment_transactions")
          .update({ status: "failed" })
          .eq("id", txn.id);

        await serviceClient.from("mock_stripe_events").insert({
          event_type: "payment_intent.failed",
          payment_intent_id,
          payload: { transaction_id: txn.id, reason: "simulated_failure" },
        });

        return json({ status: "failed", payment_intent_id });
      }

      // === SUCCESS FLOW ===
      // 1. Mark succeeded
      await serviceClient
        .from("payment_transactions")
        .update({ status: "succeeded" })
        .eq("id", txn.id);

      // 2. Log event with metadata
      await serviceClient.from("mock_stripe_events").insert({
        event_type: "payment_intent.succeeded",
        payment_intent_id,
        payload: { transaction_id: txn.id, metadata: txn.metadata },
        processed: true,
      });

      // 3. Get package
      const { data: pkg } = await serviceClient
        .from("credit_packages")
        .select("*")
        .eq("id", txn.package_id)
        .single();
      if (!pkg) return json({ error: "Package not found" }, 500);

      const txnUserId = txn.user_id;
      const txnMetadata = (txn.metadata || {}) as any;

      // 4. Increase coupon usage_count
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

      // 5. Permanently tag user to influencer (first-time attribution)
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

      // 6. Handle subscription
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

      // 7. Add segmented credits to wallet
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

      // 8. Legacy user_credits
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

      // 9. Record sale - use FINAL PAID amount
      const { data: sale } = await serviceClient.from("sales").insert({
        total_amount: txn.original_price || pkg.price,
        discount_amount: txn.discount_amount || 0,
        final_amount: txn.amount,
        coupon_id: txn.coupon_id || null,
        customer_user_id: txnUserId,
      }).select().single();

      // 10. Record credit transaction
      await serviceClient.from("credit_transactions").insert({
        user_id: txnUserId,
        package_id: pkg.id,
        transaction_type: "purchase",
        credits_change: totalCredits,
        amount_paid: txn.amount,
        discount_applied: txn.discount_amount || 0,
        coupon_id: txn.coupon_id || null,
      });

      // 11. Commission from FINAL PAID amount using percentage
      if (sale && txn.influencer_id) {
        const { data: settings } = await serviceClient
          .from("global_settings")
          .select("*")
          .single();

        if (settings) {
          // Prevent double commission
          const { data: existingCommission } = await serviceClient
            .from("commissions")
            .select("id")
            .eq("sale_id", sale.id)
            .single();

          if (!existingCommission) {
            const finalPaid = Number(txn.amount);
            const inflPercent = Number(settings.influencer_commission_percent);
            const mgrPercent = Number(settings.manager_commission_percent);
            
            // Validate total doesn't exceed 100%
            const totalPercent = inflPercent + mgrPercent;
            if (totalPercent > 100) {
              console.warn(`Commission percentages exceed 100%: influencer=${inflPercent}%, manager=${mgrPercent}%`);
            }
            
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
        payment_intent_id,
        credits_added: totalCredits,
        subscription_active: pkg.billing_type === "subscription",
        original_price: txn.original_price,
        discount_amount: txn.discount_amount,
        final_paid: txn.amount,
      });
    }

    // === POST /webhook (simulate webhook events) ===
    if (req.method === "POST" && path === "webhook") {
      const { event_type, payment_intent_id, payload = {} } = await req.json();
      if (!event_type) return json({ error: "Missing event_type" }, 400);

      await serviceClient.from("mock_stripe_events").insert({
        event_type,
        payment_intent_id: payment_intent_id || null,
        payload,
      });

      return json({ received: true, event_type });
    }

    // === GET /events (admin view mock events) ===
    if (req.method === "GET" && path === "events") {
      const { data, error } = await serviceClient
        .from("mock_stripe_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ error: error.message }, 500);
      return json({ events: data });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
