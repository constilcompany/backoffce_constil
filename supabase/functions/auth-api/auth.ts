import { sanitize, isValidEmail, isValidUUID, json, safeError, checkRateLimit } from "./security.ts";

export async function handleAuth(
  req: Request,
  path: string,
  serviceClient: any
): Promise<Response | null> {

  // === POST /register ===
  if (req.method === "POST" && path === "register") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const email = sanitize(body.email, 255).toLowerCase();
    const password = body.password;
    const full_name = sanitize(body.full_name, 100);
    const first_name = sanitize(body.first_name, 50);
    const last_name = sanitize(body.last_name, 50);
    const company_name = sanitize(body.company_name, 100);
    const coupon_code = sanitize(body.coupon_code, 50);
    const phone = sanitize(body.phone, 20);
    const address = sanitize(body.address, 500);
    const zip_code = sanitize(body.zip_code, 20);
    const city = sanitize(body.city, 100);
    const state = sanitize(body.state, 100);
    const country = sanitize(body.country, 100);

    if (!email || !password || !full_name) return json({ error: "Missing required fields" }, 400);
    if (!isValidEmail(email)) return json({ error: "Invalid email format" }, 400);
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return json({ error: "Password must be 8-128 characters" }, 400);
    }

    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const allowed = await checkRateLimit(serviceClient, clientIP, "register", 5, 300);
    if (!allowed) return safeError("Too many requests", 429);

    const { data: newUser, error: createErr } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, first_name, last_name, company_name },
    });
    if (createErr) return json({ error: "Registration failed" }, 400);

    const userId = newUser.user.id;

    await serviceClient.from("profiles").update({
      user_id: userId,
      email,
      full_name,
      phone: phone || null,
      address: address || null,
      zip_code: zip_code || null,
      city: city || null,
      state: state || null,
      country: country || null,
      company_name: company_name || null,
      first_name: first_name || full_name.split(" ")[0],
      last_name: last_name || full_name.split(" ").slice(1).join(" "),
    }).eq("user_id", userId);

    if (coupon_code) {
      const upperCode = coupon_code.toUpperCase();
      const { data: coupon } = await serviceClient
        .from("coupons")
        .select("*")
        .eq("code", upperCode)
        .eq("is_active", true)
        .single();

      if (coupon) {
        const withinLimit = !coupon.usage_limit || coupon.usage_count < coupon.usage_limit;
        const notExpired = !coupon.expiry_date || new Date(coupon.expiry_date) > new Date();
        if (withinLimit && notExpired) {
          await serviceClient.from("user_attributions").insert({
            user_id: userId,
            influencer_id: coupon.influencer_id,
            coupon_id: coupon.id,
          });
          await serviceClient
            .from("coupons")
            .update({ usage_count: coupon.usage_count + 1 })
            .eq("id", coupon.id);
        }
      }
    }

    return json({ success: true, user: { id: userId, email }, message: "Account created successfully" });
  }

  // === POST /login ===
  if (req.method === "POST" && path === "login") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const email = sanitize(body.email, 255).toLowerCase();
    const password = body.password;

    if (!email || !password) return json({ error: "Missing credentials" }, 400);
    if (!isValidEmail(email)) return json({ error: "Invalid email format" }, 400);

    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const allowed = await checkRateLimit(serviceClient, `${clientIP}:${email}`, "login", 10, 300);
    if (!allowed) return safeError("Too many login attempts. Please try again later.", 429);

    const { data, error } = await serviceClient.auth.signInWithPassword({ email, password });
    if (error) return json({ error: "Invalid credentials" }, 401);

    await serviceClient.from("sessions").insert({
      user_id: data.user.id,
      is_active: true,
      ip_address: clientIP.substring(0, 45),
      user_agent: (req.headers.get("user-agent") || "").substring(0, 255),
    });

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: { id: data.user.id, email: data.user.email },
    });
  }

  // === POST /google ===
  if (req.method === "POST" && (path === "google" || path === "auth/google")) {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const idToken = body.id_token;
    if (!idToken) return json({ error: "Google id_token is required" }, 400);

    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const googleRateOk = await checkRateLimit(serviceClient, clientIP, "auth/google", 10, 300);
    if (!googleRateOk) return safeError("Too many requests", 429);

    const { data, error } = await serviceClient.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
    if (error) return json({ error: "Google sign-in failed", detail: error.message }, 401);

    const userId = data.user.id;
    const isNewUser = data.user.created_at === data.user.updated_at;

    const phone = sanitize(body.phone, 20);
    const address = sanitize(body.address, 500);
    const zip_code = sanitize(body.zip_code, 20);
    const full_name = sanitize(body.full_name, 100);
    const coupon_code = sanitize(body.coupon_code, 50);

    const profileUpdate: Record<string, string> = {};
    if (phone) profileUpdate.phone = phone;
    if (address) profileUpdate.address = address;
    if (zip_code) profileUpdate.zip_code = zip_code;
    if (full_name) profileUpdate.full_name = full_name;
    if (Object.keys(profileUpdate).length > 0) {
      await serviceClient.from("profiles").update(profileUpdate).eq("user_id", userId);
    }

    if (coupon_code && isNewUser) {
      const upperCode = coupon_code.toUpperCase();
      const { data: coupon } = await serviceClient
        .from("coupons").select("*").eq("code", upperCode).eq("is_active", true).single();
      if (coupon) {
        const withinLimit = !coupon.usage_limit || coupon.usage_count < coupon.usage_limit;
        const notExpired = !coupon.expiry_date || new Date(coupon.expiry_date) > new Date();
        if (withinLimit && notExpired) {
          const { data: existingAttr } = await serviceClient
            .from("user_attributions").select("id").eq("user_id", userId).single();
          if (!existingAttr) {
            await serviceClient.from("user_attributions").insert({
              user_id: userId, influencer_id: coupon.influencer_id, coupon_id: coupon.id,
            });
            await serviceClient.from("coupons")
              .update({ usage_count: coupon.usage_count + 1 }).eq("id", coupon.id);
          }
        }
      }
    }

    await serviceClient.from("sessions").insert({
      user_id: userId,
      is_active: true,
      ip_address: (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown").substring(0, 45),
      user_agent: (req.headers.get("user-agent") || "").substring(0, 255),
    });

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: { id: userId, email: data.user.email },
      is_new_user: isNewUser,
    });
  }

  // === POST /send-signup-otp ===
  if (req.method === "POST" && path === "send-signup-otp") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const email = sanitize(body.email, 255).toLowerCase();
    if (!email) return json({ error: "Email is required" }, 400);
    if (!isValidEmail(email)) return json({ error: "Invalid email format" }, 400);

    const { data: existingProfile } = await serviceClient
      .from("profiles").select("id").eq("email", email).single();
    if (existingProfile) {
      return json({ error: "This email is already registered. Please login instead." }, 400);
    }

    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rateLimited = await checkRateLimit(serviceClient, `${clientIP}:${email}`, "send-signup-otp", 3, 300);
    if (!rateLimited) return safeError("Too many requests", 429);

    try {
      await sendOtp(serviceClient, email, "signup");
    } catch { /* silent */ }

    return json({ success: true, message: "If the email is valid, a verification code has been sent." });
  }

  // === POST /forgot-password ===
  if (req.method === "POST" && path === "forgot-password") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const email = sanitize(body.email, 255).toLowerCase();
    if (!email) return json({ error: "Email is required" }, 400);
    if (!isValidEmail(email)) return json({ error: "Invalid email format" }, 400);

    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rateLimited = await checkRateLimit(serviceClient, `${clientIP}:${email}`, "forgot-password", 3, 300);
    if (!rateLimited) return safeError("Too many requests", 429);

    try {
      const { data: users } = await serviceClient.auth.admin.listUsers();
      const userExists = users?.users?.some((u: any) => u.email?.toLowerCase() === email);
      if (userExists) await sendOtp(serviceClient, email, "reset");
    } catch { /* silent */ }

    return json({ success: true, message: "If an account exists with that email, a reset code has been sent." });
  }

  // === POST /verify-otp ===
  if (req.method === "POST" && path === "verify-otp") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const email = sanitize(body.email, 255).toLowerCase();
    const otpCode = sanitize(body.otp, 10);
    if (!email || !otpCode) return json({ error: "Email and OTP are required" }, 400);
    if (!isValidEmail(email)) return json({ error: "Invalid email format" }, 400);

    const { data: otpRecord } = await serviceClient
      .from("password_reset_otps")
      .select("*")
      .eq("email", email)
      .eq("otp_code", otpCode)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord) return json({ error: "Invalid or expired code" }, 400);
    return json({ success: true, message: "OTP verified" });
  }

  // === POST /reset-password ===
  if (req.method === "POST" && path === "reset-password") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const email = sanitize(body.email, 255).toLowerCase();
    const otpCode = sanitize(body.otp, 10);
    const password = body.password;

    if (!email || !otpCode || !password) return json({ error: "Email, OTP and password are required" }, 400);
    if (!isValidEmail(email)) return json({ error: "Invalid email format" }, 400);
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return json({ error: "Password must be 8-128 characters" }, 400);
    }

    const { data: otpRecord } = await serviceClient
      .from("password_reset_otps")
      .select("*")
      .eq("email", email)
      .eq("otp_code", otpCode)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord) return json({ error: "Invalid or expired code" }, 400);

    await serviceClient.from("password_reset_otps").update({ used: true }).eq("id", otpRecord.id);

    const { data: users } = await serviceClient.auth.admin.listUsers();
    const targetUser = users?.users?.find((u: any) => u.email?.toLowerCase() === email);
    if (!targetUser) return json({ error: "User not found" }, 404);

    const { error } = await serviceClient.auth.admin.updateUserById(targetUser.id, { password });
    if (error) return json({ error: "Failed to update password" }, 400);

    return json({ success: true, message: "Password updated successfully" });
  }

  return null; // rota não encontrada neste módulo
}

// === HELPER INTERNO: gerar e enviar OTP ===
async function sendOtp(serviceClient: any, email: string, type: "signup" | "reset") {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await serviceClient
    .from("password_reset_otps")
    .update({ used: true })
    .eq("email", email)
    .eq("used", false);

  await serviceClient.from("password_reset_otps").insert({
    email,
    otp_code: otp,
    expires_at: expiresAt.toISOString(),
  });

  const subject = type === "signup" ? "Your Constil Verification Code" : "Your Constil Verification Code";
  const heading = type === "signup" ? "Verify Your Email" : "Your Verification Code";
  const description = type === "signup"
    ? "Use the code below to verify your email address and complete your signup. This code expires in 10 minutes."
    : "Here is your Constil verification code. This code expires in 10 minutes.";

  const sendgridKey = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!sendgridKey) return;

  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${sendgridKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: "support@constil.com", name: "Constil" },
      subject,
      content: [{
        type: "text/html",
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #1a1a1a; margin-bottom: 16px;">${heading}</h2>
            <p style="color: #555; font-size: 14px; margin-bottom: 24px;">${description}</p>
            <div style="background: #f4f4f5; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a;">${otp}</span>
            </div>
            <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
          </div>
        `,
      }],
    }),
  });
}
