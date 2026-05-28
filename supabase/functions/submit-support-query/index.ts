import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function sanitize(str: string): string {
  return str.replace(/<[^>]*>/g, "").trim();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const firstName = sanitize(body.first_name || "");
    const lastName = sanitize(body.last_name || "");
    const email = sanitize(body.email || "");
    const companyName = sanitize(body.company_name || "");
    const message = sanitize(body.message || "");

    if (!firstName || firstName.length > 100) {
      return new Response(
        JSON.stringify({ error: "First name is required (max 100 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!lastName || lastName.length > 100) {
      return new Response(
        JSON.stringify({ error: "Last name is required (max 100 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!email || !isValidEmail(email) || email.length > 255) {
      return new Response(
        JSON.stringify({ error: "Valid email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (companyName.length > 200) {
      return new Response(
        JSON.stringify({ error: "Company name too long (max 200 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!message || message.length > 2000) {
      return new Response(
        JSON.stringify({ error: "Message is required (max 2000 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { error: insertError } = await supabase
      .from("support_queries")
      .insert({
        first_name: firstName,
        last_name: lastName,
        email,
        company_name: companyName,
        message,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to submit query" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- SEND EMAIL NOTIFICATION ---
    try {
      const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY") || "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";
      
      if (SENDGRID_API_KEY) {
        const supportEmail = "support@constil.com";
        const emailBody = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
            <div style="background-color: #1A1E50; color: #fff; padding: 20px; text-align: center;">
              <h2 style="margin: 0;">New Support Request</h2>
            </div>
            <div style="padding: 24px; line-height: 1.6;">
              <p><strong>From:</strong> ${firstName} ${lastName}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Company:</strong> ${companyName || 'Not specified'}</p>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
              <p><strong>Message:</strong></p>
              <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-radius: 5px;">${message}</p>
            </div>
            <div style="background-color: #f4f4f4; color: #999; padding: 15px; text-align: center; font-size: 12px;">
              This request was submitted via the Constil Portal Client Support form.
            </div>
          </div>
        `;

        await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SENDGRID_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: supportEmail }] }],
            from: { email: "support@constil.com", name: "Constil Portal Support" },
            reply_to: { email: email, name: `${firstName} ${lastName}` },
            subject: `Support Query: ${firstName} ${lastName} (${companyName || 'N/A'})`,
            content: [{ type: "text/html", value: emailBody }],
          }),
        });
      }
    } catch (emailErr) {
      // We log but don't fail the request if email sending fails, as database insert was successful
      console.error("Email sending failed:", emailErr);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Support query submitted successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
