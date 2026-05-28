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
    // Authenticate user
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const { package_id, billing_type = "one_time", coupon_code } = await req.json();
    if (!package_id) throw new Error("Missing package_id");

    // Get package
    const { data: pkg } = await serviceClient
      .from("credit_packages")
      .select("*")
      .eq("id", package_id)
      .eq("is_active", true)
      .single();
    if (!pkg) throw new Error("Invalid or inactive package");

    // Resolve coupon — only apply discount when coupon_code is explicitly provided
    let discountPercent = 0;
    let couponId: string | null = null;
    let couponCodeResolved: string | null = null;
    let influencerId: string | null = null;
    let managerId: string | null = null;

    if (coupon_code) {
      const { data: coupon } = await serviceClient
        .from("coupons")
        .select("*, profiles!coupons_influencer_id_fkey(user_id, full_name)")
        .eq("code", coupon_code.toUpperCase())
        .eq("is_active", true)
        .single();

      if (!coupon) throw new Error("Invalid coupon code");
      if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit)
        throw new Error("Coupon usage limit reached");
      if (coupon.expiry_date && new Date(coupon.expiry_date) <= new Date())
        throw new Error("Coupon has expired");

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

    // Calculate pricing
    const originalPrice = Number(pkg.price);
    const discountAmount = Math.round((originalPrice * discountPercent) / 100 * 100) / 100;
    const finalPrice = Math.max(0, Math.round((originalPrice - discountAmount) * 100) / 100);

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Find or reference Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    const origin = req.headers.get("origin") || "https://id-preview--f720849a-f1cc-4f49-9c29-637e310cfbbe.lovable.app";

    // Build metadata for post-payment processing
    const metadata = {
      user_id: user.id,
      package_id: pkg.id,
      package_name: pkg.name,
      coupon_id: couponId || "",
      coupon_code: couponCodeResolved || "",
      influencer_id: influencerId || "",
      manager_id: managerId || "",
      original_price: String(originalPrice),
      discount_percent: String(discountPercent),
      discount_amount: String(discountAmount),
      final_price: String(finalPrice),
      billing_type,
    };

    // Create Checkout Session with the final price as a one-time line item
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: pkg.name,
              description: discountPercent > 0
                ? `Original: $${originalPrice.toFixed(2)} | Discount: ${discountPercent}% (-$${discountAmount.toFixed(2)})`
                : undefined,
            },
            unit_amount: Math.round(finalPrice * 100), // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout?package_id=${pkg.id}`,
      metadata,
    });

    // Create pending payment_transaction
    await serviceClient.from("payment_transactions").insert({
      user_id: user.id,
      package_id: pkg.id,
      amount: finalPrice,
      original_price: originalPrice,
      discount_amount: discountAmount,
      coupon_code: couponCodeResolved,
      coupon_id: couponId,
      influencer_id: influencerId,
      manager_id: managerId,
      currency: "usd",
      billing_type,
      stripe_payment_intent_id: session.id,
      status: "pending",
      payment_mode: "stripe",
      metadata,
    });

    return json({ url: session.url });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});
