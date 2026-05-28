
-- Credit packages table (admin-managed)
CREATE TABLE public.credit_packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  credit_amount INTEGER NOT NULL,
  price NUMERIC NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active packages"
  ON public.credit_packages FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage packages"
  ON public.credit_packages FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_credit_packages_updated_at
  BEFORE UPDATE ON public.credit_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- User credits table
CREATE TABLE public.user_credits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credits"
  ON public.user_credits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all credits"
  ON public.user_credits FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage credits"
  ON public.user_credits FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_user_credits_updated_at
  BEFORE UPDATE ON public.user_credits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Credit transactions log
CREATE TABLE public.credit_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  package_id UUID REFERENCES public.credit_packages(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'topup', 'consumption')),
  credits_change INTEGER NOT NULL,
  amount_paid NUMERIC DEFAULT 0,
  discount_applied NUMERIC DEFAULT 0,
  coupon_id UUID REFERENCES public.coupons(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON public.credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage transactions"
  ON public.credit_transactions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Influencers can view referred user transactions"
  ON public.credit_transactions FOR SELECT
  USING (
    coupon_id IN (
      SELECT id FROM public.coupons WHERE influencer_id = auth.uid()
    )
  );

CREATE POLICY "Managers can view team transactions"
  ON public.credit_transactions FOR SELECT
  USING (
    coupon_id IN (
      SELECT id FROM public.coupons WHERE manager_id = auth.uid()
    )
  );

-- User-influencer attribution table (permanent link)
CREATE TABLE public.user_attributions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  influencer_id UUID NOT NULL,
  coupon_id UUID REFERENCES public.coupons(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_attributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage attributions"
  ON public.user_attributions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Influencers can view own attributions"
  ON public.user_attributions FOR SELECT
  USING (influencer_id = auth.uid());

CREATE POLICY "Managers can view team attributions"
  ON public.user_attributions FOR SELECT
  USING (
    influencer_id IN (
      SELECT influencer_id FROM public.manager_influencers WHERE manager_id = auth.uid()
    )
  );

-- Auto-create user_credits on new user signup
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
  RETURN NEW;
END;
$$;
