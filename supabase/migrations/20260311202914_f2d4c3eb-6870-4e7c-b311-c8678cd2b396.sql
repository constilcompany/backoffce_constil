
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  -- Create credits record
  INSERT INTO public.user_credits (user_id, balance)
  VALUES (NEW.id, 0);
  -- Create wallet
  INSERT INTO public.user_credit_wallets (user_id)
  VALUES (NEW.id);
  -- Do NOT assign role or generate coupon here.
  -- Roles are assigned by admin/manager via edge functions only.
  RETURN NEW;
END;
$$;
