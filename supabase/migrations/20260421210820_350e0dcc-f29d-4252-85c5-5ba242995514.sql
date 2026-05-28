-- Reset wallet for admin@bethelstonecorp.com to match their active "Standard" subscription package
UPDATE public.user_credit_wallets
SET
  invoice_unlimited = false,
  estimate_unlimited = false,
  ai_estimate_unlimited = false,
  invoice_remaining = 40,
  estimate_remaining = 30,
  ai_estimate_remaining = 60,
  updated_at = now()
WHERE user_id = '445b1bb3-63bc-45d7-a08c-69067e482924';