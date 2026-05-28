import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, json, safeError, checkRateLimit, cleanupRateLimits } from "./security.ts";
import { handleAuth } from "./auth.ts";
import { handlePayments } from "./payments.ts";
import { handleCredits } from "./credits.ts";
import { handleEmail } from "./email.ts";
import { handleProfile } from "./profile.ts";

// Rotas públicas (sem autenticação)
const PUBLIC_PATHS = new Set([
  "packages",
  "register",
  "login",
  "google",
  "auth/google",
  "send-signup-otp",
  "forgot-password",
  "verify-otp",
  "reset-password",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const rawPath = url.pathname.replace(/^\/user-api\/?/, "");
  const path = rawPath.replace(/^auth\//, "");

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    cleanupRateLimits(serviceClient).catch(() => {});

    // === ROTAS PÚBLICAS ===
    if (PUBLIC_PATHS.has(path) || path === "packages") {
      // /packages é público mas também acessível autenticado
      if (req.method === "GET" && path === "packages") {
        return await handlePayments(req, path, serviceClient, "", undefined) ?? safeError("Not found", 404);
      }

      const authResponse = await handleAuth(req, path, serviceClient);
      if (authResponse) return authResponse;
    }

    // === ROTAS AUTENTICADAS ===
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return safeError("Unauthorized", 401);
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return safeError("Unauthorized", 401);

    const userId = claimsData.claims.sub as string;

    const allowed = await checkRateLimit(serviceClient, userId, path, 120, 60);
    if (!allowed) return safeError("Too many requests", 429);

    const { data: userProfile } = await serviceClient
      .from("profiles").select("email").eq("user_id", userId).single();
    const userEmail = userProfile?.email;

    // Delega para o módulo correto
    const response =
      (await handleProfile(req, path, serviceClient, userId)) ??
      (await handleCredits(req, path, serviceClient, userId)) ??
      (await handlePayments(req, path, serviceClient, userId, userEmail)) ??
      (await handleEmail(req, path, serviceClient, userId));

    if (response) return response;

    return safeError("Not found", 404);

  } catch (err) {
    console.error("[USER-API] Error:", (err as Error).message);
    return safeError("Something went wrong", 500);
  }
});
