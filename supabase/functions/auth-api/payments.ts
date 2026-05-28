import Stripe from "https://esm.sh/stripe@18.5.0";
import { sanitize, isValidUUID, json, safeError } from "./security.ts";

function getStripe() {
  return new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2024-11-20.acacia",
  });
}

export async function resolveDiscount(serviceClient: any, userId: string, couponCode?: string) {
  let discountPercent = 0;
  let couponId: string | null = null;
  let couponCodeResolved: string | null = null;
  let influencerId: string | null = null;
  let managerId: string | null = null;

  if (couponCode) {
    const sanitizedCode = sanitize(couponCode, 50).toUpperCase();
    if (!sanitizedCode) return { discountPercent, couponId, couponCodeResolved, influencerId, managerId };

    const { data: coupon } = await serviceClient
      .from("coupons")
      .select("*, profiles!coupons_influencer_id_fkey(user_id, full_name)")
      .eq("code", sanitizedCode)
      .eq("is_active", true)
      .single();

    if (coupon) {
      const withinLimit = !coupon.usage_limit || coupon.usage_count < coupon.usage_limit;
      const notExpired = !coupon.expiry_date || new Date(coupon.expiry_date) > new Date();
      if (withinLimit && notExpired) {
        discountPercent = Number(coupon.discount_percent);
        couponId = coupon.id;
        couponCodeResolved = coupon.code;
        influencerId = coupon.influencer_id;
        if (coupon.influencer_id) {
          const { data: link } = await serviceClient
            .from("manager_influencers")
            .select("manager_id")
            .eq("influencer_id", coupon.influencer_id)
            .single();
          managerId = link?.manager_id ?? null;
        }
      }
    }
  }

  return { discountPercent, couponId, couponCodeResolved, influencerId, managerId };
}

export function calculatePricing(price: number, discountPercent: number) {
  const originalPrice = Number(price);
  const discountAmount = Math.round((originalPrice * discountPercent) / 100 * 100) / 100;
  const finalPrice = Math.max(0, Math.round((originalPrice - discountAmount) * 100) / 100);
  return { originalPrice, discountAmount, finalPrice };
}

export async function processSuccessfulPayment(serviceClient: any, txn: any) {
  const txnUserId = txn.user_id;

  const { data: pkg } = await serviceClient
    .from("credit_packages").select("*").eq("id", txn.package_id).single();
  if (!pkg) throw new Error("Package not found");

  if (txn.coupon_id) {
    const { data: coupon } = await serviceClient
      .from("coupons").select("usage_count").eq("id", txn.coupon_id).single();
    if (coupon) {
      await serviceClient.from("coupons")
        .update({ usage_count: coupon.usage_count + 1 }).eq("id", txn.coupon_id);
    }
  }

  if (txn.influencer_id) {
    const { data: existingAttr } = await serviceClient
      .from("user_attributions").select("id").eq("user_id", txnUserId).single();
    if (!existingAttr) {
      await serviceClient.from("user_attributions").insert({
        user_id: txnUserId, influencer_id: txn.influencer_id, coupon_id: txn.coupon_id,
      });
    }
  }

  if (pkg.billing_type === "subscription") {
    const interval = txn.billing_type === "yearly" ? 365 : 30;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + interval);

    const { data: existingSub } = await serviceClient
      .from("subscriptions").select("*").eq("user_id", txnUserId).eq("is_active", true).single();

    if (existingSub) {
      const currentExpiry = new Date(existingSub.expiry_date);
      const newExpiry = currentExpiry > new Date()
        ? new Date(currentExpiry.getTime() + interval * 86400000)
        : expiryDate;
      await serviceClient.from("subscriptions").update({
        package_id: pkg.id,
        billing_type: txn.billing_type,
        expiry_date: newExpiry.toISOString(),
        template_tier: pkg.template_tier,
      }).eq("id", existingSub.id);
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

  const { data: wallet } = await serviceClient
    .from("user_credit_wallets").select("*").eq("user_id", txnUserId).single();

  if (wallet) {
    await serviceClient.from("user_credit_wallets").update({
      invoice_remaining: wallet.invoice_remaining + (pkg.invoice_credits || 0),
      estimate_remaining: wallet.estimate_remaining + (pkg.estimate_credits || 0),
      ai_estimate_remaining: wallet.ai_estimate_remaining + (pkg.ai_estimate_credits || 0),
      invoice_unlimited: pkg.invoice_unlimited || wallet.invoice_unlimited,
      estimate_unlimited: pkg.estimate_unlimited || wallet.estimate_unlimited,
      ai_estimate_unlimited: pkg.ai_estimate_unlimited || wallet.ai_estimate_unlimited,
    }).eq("user_id", txnUserId);
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

  const totalCredits =
    (pkg.invoice_credits || 0) +
    (pkg.estimate_credits || 0) +
    (pkg.ai_estimate_credits || 0) +
    (pkg.credit_amount || 0);

  const { data: currentCredits } = await serviceClient
    .from("user_credits").select("balance").eq("user_id", txnUserId).single();
  await serviceClient.from("user_credits")
    .update({ balance: (currentCredits?.balance ?? 0) + totalCredits }).eq("user_id", txnUserId);

  const { data: sale } = await serviceClient.from("sales").insert({
    total_amount: txn.original_price || pkg.price,
    discount_amount: txn.discount_amount || 0,
    final_amount: txn.amount,
    coupon_id: txn.coupon_id || null,
    customer_user_id: txnUserId,
  }).select().single();

  await serviceClient.from("credit_transactions").insert({
    user_id: txnUserId,
    package_id: pkg.id,
    transaction_type: "purchase",
    credits_change: totalCredits,
    amount_paid: txn.amount,
    discount_applied: txn.discount_amount || 0,
    coupon_id: txn.coupon_id || null,
  });

  if (sale && txn.influencer_id) {
    const { data: settings } = await serviceClient.from("global_settings").select("*").single();
    if (settings) {
      const { data: existingCommission } = await serviceClient
        .from("commissions").select("id").eq("sale_id", sale.id).single();
      if (!existingCommission) {
        const finalPaid = Number(txn.amount);
        const influencerAmount = Math.round((finalPaid * Number(settings.influencer_commission_percent)) / 100 * 100) / 100;
        const managerAmount = txn.manager_id
          ? Math.round((finalPaid * Number(settings.manager_commission_percent)) / 100 * 100) / 100
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

  return { totalCredits, packageName: pkg.name };
}

export async function handlePayments(
  req: Request,
  path: string,
  serviceClient: any,
  userId: string,
  userEmail: string | undefined
): Promise<Response | null> {

  // === GET /packages ===
  if (req.method === "GET" && path === "packages") {
    const { data, error } = await serviceClient
      .from("credit_packages")
      .select("id, name, credit_amount, price, billing_type, billing_interval, template_tier, invoice_credits, estimate_credits, ai_estimate_credits, invoice_unlimited, estimate_unlimited, ai_estimate_unlimited, is_active, trial_enabled, trial_days, created_at")
      .eq("is_active", true)
      .order("price", { ascending: true });
    if (error) return safeError("Failed to fetch packages", 500);
    return json({ packages: data });
  }

  // === POST /validate-coupon ===
  if (req.method === "POST" && path === "validate-coupon") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const coupon_code = sanitize(body.coupon_code, 50);
    const package_id = body.package_id;
    if (!coupon_code) return json({ error: "Missing coupon_code" }, 400);
    if (package_id && !isValidUUID(package_id)) return json({ error: "Invalid package_id" }, 400);

    const { data: coupon } = await serviceClient
      .from("coupons")
      .select("*, profiles!coupons_influencer_id_fkey(full_name)")
      .eq("code", coupon_code.toUpperCase())
      .eq("is_active", true)
      .single();

    if (!coupon) return json({ valid: false, error: "Invalid coupon code" });
    if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit)
      return json({ valid: false, error: "Coupon usage limit reached" });
    if (coupon.expiry_date && new Date(coupon.expiry_date) <= new Date())
      return json({ valid: false, error: "Coupon has expired" });

    const result: any = {
      valid: true,
      discount_percent: Number(coupon.discount_percent),
      influencer_name: coupon.profiles?.full_name || null,
    };

    if (package_id) {
      const { data: pkg } = await serviceClient
        .from("credit_packages").select("price, name").eq("id", package_id).single();
      if (pkg) {
        const { originalPrice, discountAmount, finalPrice } = calculatePricing(pkg.price, Number(coupon.discount_percent));
        result.price_preview = { original_price: originalPrice, discount_amount: discountAmount, final_price: finalPrice, package_name: pkg.name };
      }
    }

    return json(result);
  }

  // === POST /create-checkout ===
  if (req.method === "POST" && path === "create-checkout") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const { package_id, billing_type = "one_time", coupon_code, success_url, cancel_url } = body;
    if (!package_id || !isValidUUID(package_id)) return json({ error: "Invalid package_id" }, 400);

    const { data: pkg } = await serviceClient
      .from("credit_packages").select("*").eq("id", package_id).eq("is_active", true).single();
    if (!pkg) return json({ error: "Invalid or inactive package" }, 400);

    const sanitizedCoupon = coupon_code ? sanitize(coupon_code, 50) : undefined;
    const { discountPercent, couponId, couponCodeResolved, influencerId, managerId } =
      await resolveDiscount(serviceClient, userId, sanitizedCoupon);
    const { originalPrice, discountAmount, finalPrice } = calculatePricing(pkg.price, discountPercent);

    const stripe = getStripe();
    let customerId: string | undefined;
    if (userEmail) {
      const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
      if (customers.data.length > 0) customerId = customers.data[0].id;
    }

    const metadata = {
      user_id: userId, package_id: pkg.id, package_name: pkg.name,
      coupon_id: couponId || "", coupon_code: couponCodeResolved || "",
      influencer_id: influencerId || "", manager_id: managerId || "",
      original_price: String(originalPrice), discount_percent: String(discountPercent),
      discount_amount: String(discountAmount), final_price: String(finalPrice), billing_type,
    };

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : userEmail,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: pkg.name,
            description: discountPercent > 0
              ? `Original: $${originalPrice.toFixed(2)} | Discount: ${discountPercent}% (-$${discountAmount.toFixed(2)})`
              : undefined,
          },
          unit_amount: Math.round(finalPrice * 100),
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: success_url || `${req.headers.get("origin") || ""}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${req.headers.get("origin") || ""}/checkout?package_id=${pkg.id}`,
      metadata,
    });

    await serviceClient.from("payment_transactions").insert({
      user_id: userId, package_id: pkg.id, amount: finalPrice,
      original_price: originalPrice, discount_amount: discountAmount,
      coupon_code: couponCodeResolved, coupon_id: couponId,
      influencer_id: influencerId, manager_id: managerId,
      currency: "usd", billing_type, stripe_payment_intent_id: session.id,
      status: "pending", payment_mode: "stripe", metadata,
    });

    return json({ checkout_url: session.url, session_id: session.id, original_price: originalPrice, discount_percent: discountPercent, discount_amount: discountAmount, final_price: finalPrice });
  }

  // === POST /verify-payment ===
  if (req.method === "POST" && path === "verify-payment") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const { session_id } = body;
    if (!session_id || typeof session_id !== "string") return json({ error: "Missing session_id" }, 400);

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") return json({ status: "unpaid", message: "Payment not completed" });

    const { data: txn } = await serviceClient
      .from("payment_transactions").select("*").eq("stripe_payment_intent_id", session_id).single();
    if (!txn) return json({ error: "Transaction not found" }, 404);
    if (txn.user_id !== userId) return safeError("Unauthorized", 403);
    if (txn.status === "succeeded") return json({ status: "already_processed", message: "Payment already processed" });

    await serviceClient.from("payment_transactions").update({ status: "succeeded" }).eq("id", txn.id);
    const result = await processSuccessfulPayment(serviceClient, txn);

    return json({ status: "succeeded", credits_added: result.totalCredits, package_name: result.packageName, final_price: txn.amount, original_price: txn.original_price, discount_amount: txn.discount_amount });
  }

  // === POST /start-trial ===
  if (req.method === "POST" && path === "start-trial") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const { package_id, success_url, cancel_url } = body;
    if (!package_id || !isValidUUID(package_id)) return json({ error: "Invalid package_id" }, 400);

    const { data: pkg } = await serviceClient
      .from("credit_packages").select("*").eq("id", package_id).eq("is_active", true).single();
    if (!pkg) return json({ error: "Invalid or inactive package" }, 400);
    if (!pkg.trial_enabled || !pkg.trial_days) return json({ error: "Trial not available for this package" }, 400);

    const { data: existingTrial } = await serviceClient
      .from("subscriptions").select("id").eq("user_id", userId).eq("package_id", package_id).eq("is_trial", true).single();
    if (existingTrial) return json({ error: "You have already used a trial for this package" }, 400);

    const stripe = getStripe();
    let customerId: string | undefined;
    if (userEmail) {
      const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
      if (customers.data.length > 0) customerId = customers.data[0].id;
    }

    const interval = (pkg.billing_interval === "yearly") ? "year" : "month";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : userEmail,
      payment_method_collection: "always",
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: pkg.name },
          unit_amount: Math.round(Number(pkg.price) * 100),
          recurring: { interval },
        },
        quantity: 1,
      }],
      mode: "subscription",
      subscription_data: {
        trial_period_days: pkg.trial_days,
        metadata: { user_id: userId, package_id: pkg.id, package_name: pkg.name, is_trial: "true" },
      },
      metadata: { user_id: userId, package_id: pkg.id, flow: "trial" },
      success_url: success_url || `${req.headers.get("origin") || ""}/payment-success?session_id={CHECKOUT_SESSION_ID}&flow=trial`,
      cancel_url: cancel_url || `${req.headers.get("origin") || ""}/pricing`,
    });

    return json({ checkout_url: session.url, session_id: session.id, trial_days: pkg.trial_days, package_name: pkg.name });
  }

  // === POST /verify-trial ===
  if (req.method === "POST" && path === "verify-trial") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const { session_id } = body;
    if (!session_id || typeof session_id !== "string") return json({ error: "Missing session_id" }, 400);

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ["subscription"] });
    if (session.status !== "complete") return json({ status: "incomplete", message: "Checkout not completed" });

    const meta = session.metadata || {};
    const sessionUserId = meta.user_id;
    const packageId = meta.package_id;
    if (!sessionUserId || !packageId) return json({ error: "Invalid session" }, 400);
    if (sessionUserId !== userId) return safeError("Unauthorized", 403);

    const { data: existingSub } = await serviceClient
      .from("subscriptions").select("id").eq("user_id", sessionUserId).eq("package_id", packageId).eq("is_trial", true).single();
    if (existingSub) return json({ status: "already_processed", message: "Trial already activated" });

    const { data: pkg } = await serviceClient.from("credit_packages").select("*").eq("id", packageId).single();
    if (!pkg) return safeError("Package not found", 404);

    await serviceClient.from("subscriptions").update({ is_active: false, status: "replaced" }).eq("user_id", sessionUserId).eq("is_active", true);

    const now = new Date();
    const trialEnd = new Date(now.getTime() + (pkg.trial_days || 7) * 86400000);
    const stripeSubId = typeof session.subscription === "object" ? session.subscription?.id : session.subscription || null;

    await serviceClient.from("subscriptions").insert({
      user_id: sessionUserId, package_id: pkg.id, billing_type: pkg.billing_interval || "monthly",
      template_tier: pkg.template_tier, is_active: true, is_trial: true, status: "trial",
      stripe_subscription_id: stripeSubId,
      trial_start_at: now.toISOString(), trial_end_at: trialEnd.toISOString(),
      start_date: now.toISOString(), expiry_date: trialEnd.toISOString(),
    });

    const { data: wallet } = await serviceClient
      .from("user_credit_wallets").select("*").eq("user_id", sessionUserId).single();
    if (wallet) {
      await serviceClient.from("user_credit_wallets").update({
        invoice_remaining: wallet.invoice_remaining + (pkg.trial_invoice_credits ?? 0),
        estimate_remaining: wallet.estimate_remaining + (pkg.trial_estimate_credits ?? 0),
        ai_estimate_remaining: wallet.ai_estimate_remaining + (pkg.trial_ai_estimate_credits ?? 0),
      }).eq("user_id", sessionUserId);
    }

    return json({ status: "trial_activated", trial_end: trialEnd.toISOString(), trial_days: pkg.trial_days, package_name: pkg.name });
  }

  return null;
}
