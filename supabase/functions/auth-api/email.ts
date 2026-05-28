import { json, safeError } from "./security.ts";

export async function handleEmail(
  req: Request,
  path: string,
  serviceClient: any,
  userId: string
): Promise<Response | null> {

  // === POST /template/send-invoice ===
  if (req.method === "POST" && path === "template/send-invoice") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const { invoice_id: invoiceId, clients: clientIds } = body;
    if (!invoiceId || !Array.isArray(clientIds) || clientIds.length === 0) {
      return json({ error: "Missing invoice_id or clients" }, 400);
    }

    const { data: invoice, error: invError } = await serviceClient
      .from("invoices").select("*, clients(*)").eq("id", invoiceId).eq("user_id", userId).single();
    if (invError || !invoice) return json({ error: "Invoice not found" }, 404);

    const { data: clients, error: clientError } = await serviceClient
      .from("clients").select("email").in("id", clientIds);
    if (clientError) return json({ error: "Failed to fetch clients" }, 500);

    const recipients = clients.map((c: any) => c.email).filter(Boolean);
    if (recipients.length === 0) return json({ error: "No valid recipient emails found" }, 400);

    const documentUrl = invoice.document_url || invoice.documentUrl;
    if (!documentUrl) return json({ error: "Invoice document not found" }, 404);

    const emailBody = buildEmailHtml(
      `Invoice ${invoice.invoice_number}`,
      "Please find your invoice from Constil attached at the link below:",
      documentUrl,
      "View Invoice PDF",
      "This invoice was sent via Constil Portal."
    );

    try {
      const sent = await sendEmail({
        recipients,
        subject: `Invoice ${invoice.invoice_number} from Constil`,
        html: emailBody,
      });
      if (!sent) return json({ error: "Failed to send email" }, 500);

      await serviceClient.from("invoice_mails").insert({
        user_id: userId, invoice_id: invoiceId, client_ids: clientIds,
        recipient_emails: recipients, file_url: documentUrl, status: "sent",
      });
      await serviceClient.from("invoices")
        .update({ sent_at: new Date().toISOString(), status: "sent" }).eq("id", invoiceId);
    } catch (err) {
      console.error("Email send error:", err);
      return json({ error: "Failed to send email" }, 500);
    }

    return json({ success: true, message: "Email sent successfully" });
  }

  // === POST /template/send-estimate ===
  if (req.method === "POST" && path === "template/send-estimate") {
    let body: any;
    try { body = await req.json(); } catch { return safeError("Invalid request body", 400); }

    const { estimate_id: estimateId, clients: clientIds } = body;
    if (!estimateId || !Array.isArray(clientIds) || clientIds.length === 0) {
      return json({ error: "Missing estimate_id or clients" }, 400);
    }

    const { data: estimate, error: estError } = await serviceClient
      .from("estimates").select("*, clients(*)").eq("id", estimateId).eq("user_id", userId).single();
    if (estError || !estimate) return json({ error: "Estimate not found" }, 404);

    const { data: clients, error: clientError } = await serviceClient
      .from("clients").select("email").in("id", clientIds);
    if (clientError) return json({ error: "Failed to fetch clients" }, 500);

    const recipients = clients.map((c: any) => c.email).filter(Boolean);
    if (recipients.length === 0) return json({ error: "No valid recipient emails found" }, 400);

    const documentUrl = estimate.document_url || estimate.documentUrl;
    if (!documentUrl) return json({ error: "Estimate document not found" }, 404);

    const emailBody = buildEmailHtml(
      `Estimate ${estimate.estimate_number}`,
      "Please find your estimate from Constil attached at the link below:",
      documentUrl,
      "View Estimate PDF",
      "This estimate was sent via Constil Portal."
    );

    try {
      const sent = await sendEmail({
        recipients,
        subject: `Estimate ${estimate.estimate_number} from Constil`,
        html: emailBody,
      });
      if (!sent) return json({ error: "Failed to send email" }, 500);

      await serviceClient.from("estimate_mails").insert({
        user_id: userId, estimate_id: estimateId, client_ids: clientIds,
        recipient_emails: recipients, file_url: documentUrl, status: "sent",
      });
      await serviceClient.from("estimates")
        .update({ sent_at: new Date().toISOString(), status: "sent" }).eq("id", estimateId);
    } catch (err) {
      console.error("Email send error:", err);
      return json({ error: "Failed to send email" }, 500);
    }

    return json({ success: true, message: "Email sent successfully" });
  }

  return null;
}

// === HELPERS INTERNOS ===

function buildEmailHtml(
  title: string,
  description: string,
  documentUrl: string,
  buttonText: string,
  footer: string
): string {
  return `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
      <div style="background-color: #1A1E50; color: #fff; padding: 20px; text-align: center;">
        <h2 style="margin: 0;">${title}</h2>
      </div>
      <div style="padding: 24px; line-height: 1.6;">
        <p>Hello,</p>
        <p>${description}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${documentUrl}" style="background-color: #448AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">${buttonText}</a>
        </div>
        <p style="font-size: 12px; color: #999;">If the button doesn't work, copy and paste this link: ${documentUrl}</p>
      </div>
      <div style="background-color: #f4f4f4; color: #999; padding: 15px; text-align: center; font-size: 12px;">
        ${footer}
      </div>
    </div>
  `;
}

async function sendEmail({ recipients, subject, html }: {
  recipients: string[];
  subject: string;
  html: string;
}): Promise<boolean> {
  const sendgridKey = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!sendgridKey) return false;

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: recipients.map((email: string) => ({ email })) }],
      from: { email: "support@constil.com", name: "Constil" },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });

  return res.ok;
}
