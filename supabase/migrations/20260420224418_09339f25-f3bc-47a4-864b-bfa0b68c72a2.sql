CREATE TABLE IF NOT EXISTS legacy_user_map (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), old_user_id text, new_user_id uuid);
-- Wipe legacy-mapped data so we can re-import cleanly. Keeps auth, profiles, roles, subscriptions intact.
DELETE FROM ai_estimate_results;
DELETE FROM ai_estimates;
DELETE FROM ai_invoices;
DELETE FROM invoice_items;
DELETE FROM invoices;
DELETE FROM estimate_items;
DELETE FROM estimates;
DELETE FROM clients;
DELETE FROM products;
DELETE FROM legacy_user_map;