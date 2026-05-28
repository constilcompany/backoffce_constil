
-- App role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'influencer');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  bank_account TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'bank_transfer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles table (separate from profiles per security requirements)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'influencer',
  UNIQUE(user_id, role)
);

-- Manager-Influencer relationship
CREATE TABLE public.manager_influencers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
  influencer_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(influencer_id)
);

-- Global settings (singleton)
CREATE TABLE public.global_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_commission_fixed NUMERIC(10,2) NOT NULL DEFAULT 10.00,
  manager_override_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  lock_period_days INTEGER NOT NULL DEFAULT 30,
  minimum_payout_threshold NUMERIC(10,2) NOT NULL DEFAULT 50.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Coupons
CREATE TABLE public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  influencer_id UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  manager_id UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  expiry_date TIMESTAMPTZ,
  usage_limit INTEGER DEFAULT 100,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sales
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  final_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Commissions
CREATE TABLE public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID REFERENCES public.sales(id) ON DELETE CASCADE NOT NULL,
  influencer_id UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  manager_id UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  influencer_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  manager_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'unlocked', 'paid')),
  unlock_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payout requests
CREATE TABLE public.payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Get user role function
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  -- Default role is influencer
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'influencer');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_payout_requests_updated_at BEFORE UPDATE ON public.payout_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_global_settings_updated_at BEFORE UPDATE ON public.global_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS POLICIES

-- Profiles: users see own, admins see all, managers see their influencers
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can view team profiles" ON public.profiles FOR SELECT USING (
  public.has_role(auth.uid(), 'manager') AND
  user_id IN (SELECT influencer_id FROM public.manager_influencers WHERE manager_id = auth.uid())
);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- User roles: only admins manage, users can read own
CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Manager-influencer: admins and managers
CREATE POLICY "Admins can manage relationships" ON public.manager_influencers FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can view own team" ON public.manager_influencers FOR SELECT USING (manager_id = auth.uid());
CREATE POLICY "Managers can insert to own team" ON public.manager_influencers FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'manager') AND manager_id = auth.uid()
);

-- Global settings: admins manage, all authenticated read
CREATE POLICY "Anyone authenticated can read settings" ON public.global_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage settings" ON public.global_settings FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Coupons: admins see all, managers see own, influencers see assigned
CREATE POLICY "Admins can manage coupons" ON public.coupons FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can manage own coupons" ON public.coupons FOR ALL USING (
  public.has_role(auth.uid(), 'manager') AND manager_id = auth.uid()
);
CREATE POLICY "Influencers can view own coupons" ON public.coupons FOR SELECT USING (influencer_id = auth.uid());

-- Sales: admins see all, influencers see own via coupon
CREATE POLICY "Admins can view all sales" ON public.sales FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Influencers can view own sales" ON public.sales FOR SELECT USING (
  coupon_id IN (SELECT id FROM public.coupons WHERE influencer_id = auth.uid())
);
CREATE POLICY "Managers can view team sales" ON public.sales FOR SELECT USING (
  coupon_id IN (SELECT id FROM public.coupons WHERE manager_id = auth.uid())
);

-- Commissions: admins see all, users see own
CREATE POLICY "Admins can manage commissions" ON public.commissions FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Influencers can view own commissions" ON public.commissions FOR SELECT USING (influencer_id = auth.uid());
CREATE POLICY "Managers can view own commissions" ON public.commissions FOR SELECT USING (manager_id = auth.uid());

-- Payout requests: admins manage all, users manage own
CREATE POLICY "Admins can manage payouts" ON public.payout_requests FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view own payouts" ON public.payout_requests FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own payouts" ON public.payout_requests FOR INSERT WITH CHECK (user_id = auth.uid());

-- Insert default global settings
INSERT INTO public.global_settings (influencer_commission_fixed, manager_override_percent, lock_period_days, minimum_payout_threshold)
VALUES (10.00, 10.00, 30, 50.00);
