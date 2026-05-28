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
    if (!user?.email) throw new Error("User not authenticated");

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/stripe-connect\/?/, "");
    const body = req.method === "POST" ? await req.json() : {};

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const origin = req.headers.get("origin") || "https://id-preview--f720849a-f1cc-4f49-9c29-637e310cfbbe.lovable.app";

    // === POST /onboard — Create Connect account and return onboarding link ===
    if (path === "onboard") {
      // Check if user already has a Stripe account
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("stripe_account_id, stripe_onboarding_complete")
        .eq("user_id", user.id)
        .single();

      let accountId = profile?.stripe_account_id;

      if (!accountId) {
        // Create a new Stripe Connect Express account
        const account = await stripe.accounts.create({
          type: "express",
          email: user.email,
          metadata: { user_id: user.id },
        });
        accountId = account.id;

        // Save to profile
        await serviceClient
          .from("profiles")
          .update({ stripe_account_id: accountId } as any)
          .eq("user_id", user.id);
      }

      // Create onboarding link
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${origin}/dashboard/profile?stripe_refresh=true`,
        return_url: `${origin}/dashboard/profile?stripe_connected=true`,
        type: "account_onboarding",
      });

      return json({ url: accountLink.url, account_id: accountId });
    }

    // === GET /status — Check Connect account status ===
    if (path === "status") {
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("stripe_account_id, stripe_onboarding_complete")
        .eq("user_id", user.id)
        .single();

      if (!profile?.stripe_account_id) {
        return json({ connected: false, onboarding_complete: false });
      }

      // Check with Stripe if onboarding is complete
      const account = await stripe.accounts.retrieve(profile.stripe_account_id);
      const isComplete = account.charges_enabled && account.payouts_enabled;

      // Update profile if status changed
      if (isComplete !== profile.stripe_onboarding_complete) {
        await serviceClient
          .from("profiles")
          .update({ stripe_onboarding_complete: isComplete } as any)
          .eq("user_id", user.id);
      }

      return json({
        connected: true,
        onboarding_complete: isComplete,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        account_id: profile.stripe_account_id,
      });
    }

    // === POST /dashboard — Get Stripe Express dashboard link ===
    if (path === "dashboard") {
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (!profile?.stripe_account_id) throw new Error("No Stripe account linked");

      const loginLink = await stripe.accounts.createLoginLink(profile.stripe_account_id);
      return json({ url: loginLink.url });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});
