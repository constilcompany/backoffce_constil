import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Find all active trial subscriptions past their trial_end_at
    const { data: expiredTrials, error } = await serviceClient
      .from("subscriptions")
      .select("id, user_id")
      .eq("is_active", true)
      .eq("is_trial", true)
      .eq("status", "trial")
      .lt("trial_end_at", new Date().toISOString());

    if (error) {
      console.error("Error fetching expired trials:", error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiredIds = (expiredTrials ?? []).map((t) => t.id);

    if (expiredIds.length > 0) {
      const { error: updateErr } = await serviceClient
        .from("subscriptions")
        .update({ is_active: false, status: "expired" })
        .in("id", expiredIds);

      if (updateErr) {
        console.error("Error expiring trials:", updateErr.message);
      } else {
        console.log(`Expired ${expiredIds.length} trial subscription(s)`);
      }
    } else {
      console.log("No expired trials found");
    }

    return new Response(
      JSON.stringify({ expired_count: expiredIds.length }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("expire-trials error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
