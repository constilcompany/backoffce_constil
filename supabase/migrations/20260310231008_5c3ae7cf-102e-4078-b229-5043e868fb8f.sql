ALTER TABLE public.profiles 
  ADD COLUMN stripe_account_id text DEFAULT NULL,
  ADD COLUMN stripe_onboarding_complete boolean DEFAULT false;