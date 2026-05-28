
-- Fix commissions RLS: drop restrictive, recreate as permissive
DROP POLICY IF EXISTS "Admins can manage commissions" ON public.commissions;
DROP POLICY IF EXISTS "Influencers can view own commissions" ON public.commissions;
DROP POLICY IF EXISTS "Managers can view own commissions" ON public.commissions;

CREATE POLICY "Admins can manage commissions" ON public.commissions FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Influencers can view own commissions" ON public.commissions FOR SELECT TO public USING (influencer_id = auth.uid());
CREATE POLICY "Managers can view own commissions" ON public.commissions FOR SELECT TO public USING (manager_id = auth.uid());

-- Fix sales RLS
DROP POLICY IF EXISTS "Admins can view all sales" ON public.sales;
DROP POLICY IF EXISTS "Influencers can view own sales" ON public.sales;
DROP POLICY IF EXISTS "Managers can view team sales" ON public.sales;

CREATE POLICY "Admins can view all sales" ON public.sales FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Influencers can view own sales" ON public.sales FOR SELECT TO public USING (coupon_id IN (SELECT coupons.id FROM coupons WHERE coupons.influencer_id = auth.uid()));
CREATE POLICY "Managers can view team sales" ON public.sales FOR SELECT TO public USING (coupon_id IN (SELECT coupons.id FROM coupons WHERE coupons.manager_id = auth.uid()));

-- Fix coupons RLS
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
DROP POLICY IF EXISTS "Influencers can view own coupons" ON public.coupons;
DROP POLICY IF EXISTS "Managers can view team influencer coupons" ON public.coupons;
DROP POLICY IF EXISTS "Managers can update team influencer coupons" ON public.coupons;

CREATE POLICY "Admins can manage coupons" ON public.coupons FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Influencers can view own coupons" ON public.coupons FOR SELECT TO public USING (influencer_id = auth.uid());
CREATE POLICY "Managers can view team influencer coupons" ON public.coupons FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role) AND influencer_id IN (SELECT manager_influencers.influencer_id FROM manager_influencers WHERE manager_influencers.manager_id = auth.uid()));
CREATE POLICY "Managers can update team influencer coupons" ON public.coupons FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'manager'::app_role) AND influencer_id IN (SELECT manager_influencers.influencer_id FROM manager_influencers WHERE manager_influencers.manager_id = auth.uid()));

-- Fix credit_transactions RLS
DROP POLICY IF EXISTS "Admins can manage transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "Influencers can view referred user transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "Managers can view team transactions" ON public.credit_transactions;

CREATE POLICY "Admins can manage transactions" ON public.credit_transactions FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own transactions" ON public.credit_transactions FOR SELECT TO public USING (auth.uid() = user_id);
CREATE POLICY "Influencers can view referred user transactions" ON public.credit_transactions FOR SELECT TO public USING (coupon_id IN (SELECT coupons.id FROM coupons WHERE coupons.influencer_id = auth.uid()));
CREATE POLICY "Managers can view team transactions" ON public.credit_transactions FOR SELECT TO public USING (coupon_id IN (SELECT coupons.id FROM coupons WHERE coupons.manager_id = auth.uid()));

-- Fix user_attributions RLS
DROP POLICY IF EXISTS "Admins can manage attributions" ON public.user_attributions;
DROP POLICY IF EXISTS "Influencers can view own attributions" ON public.user_attributions;
DROP POLICY IF EXISTS "Managers can view team attributions" ON public.user_attributions;

CREATE POLICY "Admins can manage attributions" ON public.user_attributions FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Influencers can view own attributions" ON public.user_attributions FOR SELECT TO public USING (influencer_id = auth.uid());
CREATE POLICY "Managers can view team attributions" ON public.user_attributions FOR SELECT TO public USING (influencer_id IN (SELECT manager_influencers.influencer_id FROM manager_influencers WHERE manager_influencers.manager_id = auth.uid()));

-- Fix remaining tables
DROP POLICY IF EXISTS "Admins can manage settings" ON public.global_settings;
DROP POLICY IF EXISTS "Anyone authenticated can read settings" ON public.global_settings;
CREATE POLICY "Admins can manage settings" ON public.global_settings FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anyone authenticated can read settings" ON public.global_settings FOR SELECT TO public USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage packages" ON public.credit_packages;
DROP POLICY IF EXISTS "Anyone can view active packages" ON public.credit_packages;
CREATE POLICY "Admins can manage packages" ON public.credit_packages FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anyone can view active packages" ON public.credit_packages FOR SELECT TO public USING (is_active = true);

DROP POLICY IF EXISTS "Admins can manage credit config" ON public.credit_action_config;
DROP POLICY IF EXISTS "Authenticated users can read credit config" ON public.credit_action_config;
CREATE POLICY "Admins can manage credit config" ON public.credit_action_config FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users can read credit config" ON public.credit_action_config FOR SELECT TO public USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT TO public USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Managers can view team profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO public USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO public USING (auth.uid() = user_id);
CREATE POLICY "Managers can view team profiles" ON public.profiles FOR SELECT TO public USING (has_role(auth.uid(), 'manager'::app_role) AND user_id IN (SELECT manager_influencers.influencer_id FROM manager_influencers WHERE manager_influencers.manager_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage wallets" ON public.user_credit_wallets;
DROP POLICY IF EXISTS "Users can view own wallet" ON public.user_credit_wallets;
CREATE POLICY "Admins can manage wallets" ON public.user_credit_wallets FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own wallet" ON public.user_credit_wallets FOR SELECT TO public USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage credits" ON public.user_credits;
DROP POLICY IF EXISTS "Admins can view all credits" ON public.user_credits;
DROP POLICY IF EXISTS "Users can view own credits" ON public.user_credits;
CREATE POLICY "Admins can manage credits" ON public.user_credits FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own credits" ON public.user_credits FOR SELECT TO public USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage payment transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "Users can view own payment transactions" ON public.payment_transactions;
CREATE POLICY "Admins can manage payment transactions" ON public.payment_transactions FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own payment transactions" ON public.payment_transactions FOR SELECT TO public USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage payouts" ON public.payout_requests;
DROP POLICY IF EXISTS "Users can create own payouts" ON public.payout_requests;
DROP POLICY IF EXISTS "Users can view own payouts" ON public.payout_requests;
CREATE POLICY "Admins can manage payouts" ON public.payout_requests FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can create own payouts" ON public.payout_requests FOR INSERT TO public WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can view own payouts" ON public.payout_requests FOR SELECT TO public USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage relationships" ON public.manager_influencers;
DROP POLICY IF EXISTS "Managers can view own team" ON public.manager_influencers;
DROP POLICY IF EXISTS "Managers can insert to own team" ON public.manager_influencers;
CREATE POLICY "Admins can manage relationships" ON public.manager_influencers FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Managers can view own team" ON public.manager_influencers FOR SELECT TO public USING (manager_id = auth.uid());
CREATE POLICY "Managers can insert to own team" ON public.manager_influencers FOR INSERT TO public WITH CHECK (has_role(auth.uid(), 'manager'::app_role) AND manager_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage mock events" ON public.mock_stripe_events;
CREATE POLICY "Admins can manage mock events" ON public.mock_stripe_events FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Admins can manage subscriptions" ON public.subscriptions FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions FOR SELECT TO public USING (auth.uid() = user_id);
