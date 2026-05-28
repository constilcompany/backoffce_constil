-- Add trial fields to credit_packages
ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS trial_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_days integer;

-- Add trial fields to subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Prevent duplicate trials: one trial per user per package
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_trial_per_user_package
  ON public.subscriptions (user_id, package_id)
  WHERE (is_trial = true);