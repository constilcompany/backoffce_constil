import { json, safeError } from "./security.ts";

export async function handleProfile(
  req: Request,
  path: string,
  serviceClient: any,
  userId: string
): Promise<Response | null> {

  // === GET /get_profile ===
  if (req.method === "GET" && path === "get_profile") {
    const { data, error } = await serviceClient
      .from("profiles").select("*").eq("user_id", userId).maybeSingle();
    if (error) return json({ status: false, message: "Failed to fetch profile", data: null }, 500);
    if (!data) return json({ status: false, message: "Profile not found", data: null }, 404);
    return json({ status: true, message: "Success", data });
  }

  // === GET /list_invoices ===
  if (req.method === "GET" && path === "list_invoices") {
    const { data, error } = await serviceClient
      .from("invoices").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) return json({ status: false, message: "Failed to fetch invoices", data: [] }, 500);
    return json({ status: true, message: "Success", data: data ?? [] });
  }

  return null;
}
