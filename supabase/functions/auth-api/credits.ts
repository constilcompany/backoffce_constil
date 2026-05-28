import { sanitize, json, safeError } from "./security.ts";

export async function handleCredits(
  req: Request,
  path: string,
  serviceClient: any,
  userId: string
): Promise<Response | null> {

  // === GET /credits ===
  if (req.method === "GET" && path === "credits") {
    const { data, error } = await serviceClient
      .from("user_credits").select("balance").eq("user_id", userId).single();
    if (error) return safeError("Failed to fetch credits", 500);
    return json({ credits: data?.balance ?? 0 });
  }

  // === GET /wallet ===
  if (req.method === "GET" && path === "wallet") {
    const { data, error } = await serviceClient
      .from("user_credit_wallets").select("*").eq("user_id", userId).single();
    if (error) {
      if (error.code === "PGRST116") {
        return json({
          wallet: {
            user_id: userId,
            invoice_remaining: 0,
            estimate_remaining: 0,
            ai_estimate_remaining: 0,
            invoice_unlimited: false,
            estimate_unlimited: false,
            ai_estimate_unlimited: false,
          },
        });
      }
      return safeError("Failed to fetch wallet", 500);
    }
    return json({ wallet: data });
  }

  // === GET /subscription ===
  if (req.method === "GET" && path === "subscription") {
    const { data, error } = await serviceClient
      .from("subscriptions")
      .select("*, credit_packages(*)")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();
    if (error && error.code !== "PGRST116") return safeError("Failed to fetch subscription", 500);

    if (data && data.is_trial && data.trial_end_at) {
      const now = new Date();
      const end = new Date(data.trial_end_at);
      const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
      (data as any).trial_days_remaining = daysLeft;
    }

    return json({ subscription: data || null });
  }

  // === GET /template-access ===
  if (req.method === "GET" && path === "template-access") {
    const { data: sub } = await serviceClient
      .from("subscriptions").select("template_tier").eq("user_id", userId).eq("is_active", true).single();

    const tier = sub?.template_tier || "basic";
    const access: Record<string, string[]> = {
      basic: ["basic"],
      professional: ["basic", "professional"],
      enterprise: ["basic", "professional", "enterprise"],
    };
    return json({ tier, templates: access[tier] || ["basic"] });
  }

  // === GET /credit-config ===
  if (req.method === "GET" && path === "credit-config") {
    const { data, error } = await serviceClient
      .from("credit_action_config").select("action_type, credit_cost, is_active").eq("is_active", true);
    if (error) return safeError("Failed to fetch config", 500);
    return json({ config: data });
  }

  // === POST /consume-credit ===
  if (req.method === "POST" && path === "consume-credit") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const action_type = sanitize(body.action_type, 50);
    const reference_id = body.reference_id ? sanitize(body.reference_id, 255) : null;
    if (!action_type) return json({ error: "Missing action_type" }, 400);

    const validActions = ["invoice", "estimate", "ai_estimate"];
    if (!validActions.includes(action_type)) return json({ error: "Invalid action type" }, 400);

    const { data: actionConfig } = await serviceClient
      .from("credit_action_config").select("credit_cost, is_active").eq("action_type", action_type).single();
    if (!actionConfig) return json({ error: "Unknown action" }, 400);
    if (!actionConfig.is_active) return json({ error: "Action currently disabled" }, 403);

    const cost = actionConfig.credit_cost;

    const { data: wallet } = await serviceClient
      .from("user_credit_wallets").select("*").eq("user_id", userId).single();

    const bucketMap: Record<string, { remaining: string; unlimited: string }> = {
      invoice: { remaining: "invoice_remaining", unlimited: "invoice_unlimited" },
      estimate: { remaining: "estimate_remaining", unlimited: "estimate_unlimited" },
      ai_estimate: { remaining: "ai_estimate_remaining", unlimited: "ai_estimate_unlimited" },
    };
    const bucket = bucketMap[action_type];

    if (wallet && bucket) {
      const isUnlimited = wallet[bucket.unlimited as keyof typeof wallet] as boolean;
      const remaining = wallet[bucket.remaining as keyof typeof wallet] as number;

      if (isUnlimited) {
        await serviceClient.from("credit_transactions").insert({
          user_id: userId, transaction_type: "consumption",
          credits_change: 0, amount_paid: 0,
          reference_id: reference_id || `${action_type}_unlimited`,
        });
        return json({ success: true, credits_deducted: 0, remaining_credits: remaining, unlimited: true });
      }

      if (remaining >= cost) {
        await serviceClient.from("user_credit_wallets")
          .update({ [bucket.remaining]: remaining - cost }).eq("user_id", userId);
        await serviceClient.from("credit_transactions").insert({
          user_id: userId, transaction_type: "consumption",
          credits_change: -cost, amount_paid: 0, reference_id: reference_id || null,
        });
        return json({ success: true, credits_deducted: cost, remaining_credits: remaining - cost, bucket: action_type });
      }
    }

    // Fallback: pool legado
    const { data: credits } = await serviceClient
      .from("user_credits").select("balance").eq("user_id", userId).single();

    if (!credits || credits.balance < cost) {
      return json({ error: "Insufficient credits. Please top up.", can_generate: false, required: cost, available: credits?.balance ?? 0 }, 402);
    }

    await serviceClient.from("user_credits").update({ balance: credits.balance - cost }).eq("user_id", userId);
    await serviceClient.from("credit_transactions").insert({
      user_id: userId, transaction_type: "consumption",
      credits_change: -cost, amount_paid: 0, reference_id: reference_id || null,
    });

    return json({ success: true, credits_deducted: cost, remaining_credits: credits.balance - cost, can_generate: credits.balance - cost >= cost });
  }

  // === POST /invoice-generated (legado) ===
  if (req.method === "POST" && path === "invoice-generated") {
    const { data: actionConfig } = await serviceClient
      .from("credit_action_config").select("credit_cost").eq("action_type", "invoice").eq("is_active", true).single();
    const cost = actionConfig?.credit_cost ?? 1;

    const { data: credits } = await serviceClient
      .from("user_credits").select("balance").eq("user_id", userId).single();
    if (!credits || credits.balance < cost) return json({ error: "Insufficient credits", can_generate: false }, 402);

    await serviceClient.from("user_credits").update({ balance: credits.balance - cost }).eq("user_id", userId);
    await serviceClient.from("credit_transactions").insert({
      user_id: userId, transaction_type: "consumption", credits_change: -cost, amount_paid: 0, reference_id: null,
    });

    return json({ success: true, remaining_credits: credits.balance - cost, can_generate: credits.balance - cost >= cost });
  }

  return null;
}
