ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS trial_invoice_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_estimate_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_ai_estimate_credits integer NOT NULL DEFAULT 0;