
-- Create credit_action_config table for dynamic credit costs
CREATE TABLE public.credit_action_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL UNIQUE,
  credit_cost integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.credit_action_config ENABLE ROW LEVEL SECURITY;

-- Only admins can modify
CREATE POLICY "Admins can manage credit config"
ON public.credit_action_config FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Anyone authenticated can read (needed for frontend to fetch costs)
CREATE POLICY "Authenticated users can read credit config"
ON public.credit_action_config FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_credit_action_config_updated_at
BEFORE UPDATE ON public.credit_action_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Seed default action configs
INSERT INTO public.credit_action_config (action_type, credit_cost) VALUES
  ('invoice', 1),
  ('estimate', 2),
  ('ai_estimate', 50);

-- Add consumption tracking columns to credit_transactions
-- action_type already exists, add reference_id for audit trail
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS reference_id text;
