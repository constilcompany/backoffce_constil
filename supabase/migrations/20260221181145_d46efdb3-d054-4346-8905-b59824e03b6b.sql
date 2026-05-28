
-- 1. Add subscription-related columns to credit_packages
ALTER TABLE public.credit_packages
ADD COLUMN billing_type text NOT NULL DEFAULT 'one_time',
ADD COLUMN billing_interval text DEFAULT NULL,
ADD COLUMN template_tier text NOT NULL DEFAULT 'basic',
ADD COLUMN invoice_credits integer NOT NULL DEFAULT 0,
ADD COLUMN estimate_credits integer NOT NULL DEFAULT 0,
ADD COLUMN ai_estimate_credits integer NOT NULL DEFAULT 0,
ADD COLUMN invoice_unlimited boolean NOT NULL DEFAULT false,
ADD COLUMN estimate_unlimited boolean NOT NULL DEFAULT false,
ADD COLUMN ai_estimate_unlimited boolean NOT NULL DEFAULT false;

-- 2. Segmented credit wallet per user
CREATE TABLE public.user_credit_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  invoice_remaining integer NOT NULL DEFAULT 0,
  estimate_remaining integer NOT NULL DEFAULT 0,
  ai_estimate_remaining integer NOT NULL DEFAULT 0,
  invoice_unlimited boolean NOT NULL DEFAULT false,
  estimate_unlimited boolean NOT NULL DEFAULT false,
  ai_estimate_unlimited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_credit_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage wallets" ON public.user_credit_wallets FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own wallet" ON public.user_credit_wallets FOR SELECT USING (auth.uid() = user_id);

-- 3. Subscriptions table
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  package_id uuid NOT NULL REFERENCES public.credit_packages(id),
  billing_type text NOT NULL DEFAULT 'monthly',
  start_date timestamptz NOT NULL DEFAULT now(),
  expiry_date timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  template_tier text NOT NULL DEFAULT 'basic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage subscriptions" ON public.subscriptions FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

-- 4. Payment transactions table
CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  package_id uuid REFERENCES public.credit_packages(id),
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  billing_type text NOT NULL DEFAULT 'one_time',
  stripe_payment_intent_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  payment_mode text NOT NULL DEFAULT 'mock',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage payment transactions" ON public.payment_transactions FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own payment transactions" ON public.payment_transactions FOR SELECT USING (auth.uid() = user_id);

-- 5. Mock stripe events log
CREATE TABLE public.mock_stripe_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payment_intent_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mock_stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage mock events" ON public.mock_stripe_events FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 6. Global setting for payment mode
ALTER TABLE public.global_settings
ADD COLUMN payment_mode text NOT NULL DEFAULT 'mock';

-- 7. Update handle_new_user to also create wallet
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'influencer');
  INSERT INTO public.user_credits (user_id, balance)
  VALUES (NEW.id, 0);
  INSERT INTO public.user_credit_wallets (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- 8. Triggers for updated_at
CREATE TRIGGER update_user_credit_wallets_updated_at
BEFORE UPDATE ON public.user_credit_wallets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_payment_transactions_updated_at
BEFORE UPDATE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
