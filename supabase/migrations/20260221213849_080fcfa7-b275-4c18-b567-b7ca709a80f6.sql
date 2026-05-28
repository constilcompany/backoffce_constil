
-- Add auto_generated column to coupons
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false;

-- Add metadata columns to payment_transactions
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS original_price numeric DEFAULT 0;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS coupon_code text DEFAULT NULL;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS coupon_id uuid DEFAULT NULL;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS influencer_id uuid DEFAULT NULL;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS manager_id uuid DEFAULT NULL;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Create function to auto-generate coupon when influencer is created
CREATE OR REPLACE FUNCTION public.auto_create_influencer_coupon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _influencer_name text;
  _coupon_code text;
  _default_discount numeric;
  _counter int := 0;
BEGIN
  -- Only for influencer role
  IF NEW.role != 'influencer' THEN
    RETURN NEW;
  END IF;

  -- Get influencer name from profiles
  SELECT full_name INTO _influencer_name
  FROM public.profiles WHERE user_id = NEW.user_id;

  -- Get default discount from global settings
  SELECT COALESCE(influencer_commission_fixed, 10) INTO _default_discount
  FROM public.global_settings LIMIT 1;

  -- If no settings, default to 10
  IF _default_discount IS NULL THEN
    _default_discount := 10;
  END IF;

  -- Generate coupon code from name
  IF _influencer_name IS NOT NULL AND _influencer_name != '' THEN
    _coupon_code := UPPER(REGEXP_REPLACE(_influencer_name, '[^a-zA-Z0-9]', '', 'g')) || CAST(_default_discount AS int);
  ELSE
    _coupon_code := 'AUTO-' || UPPER(SUBSTRING(NEW.user_id::text FROM 1 FOR 8));
  END IF;

  -- Handle duplicates
  WHILE EXISTS (SELECT 1 FROM public.coupons WHERE code = _coupon_code) LOOP
    _counter := _counter + 1;
    IF _influencer_name IS NOT NULL AND _influencer_name != '' THEN
      _coupon_code := UPPER(REGEXP_REPLACE(_influencer_name, '[^a-zA-Z0-9]', '', 'g')) || CAST(_default_discount AS int) || _counter;
    ELSE
      _coupon_code := 'AUTO-' || UPPER(SUBSTRING(NEW.user_id::text FROM 1 FOR 8)) || _counter;
    END IF;
  END LOOP;

  INSERT INTO public.coupons (code, influencer_id, discount_percent, auto_generated, is_active, usage_limit)
  VALUES (_coupon_code, NEW.user_id, _default_discount, true, true, 1000);

  RETURN NEW;
END;
$$;

-- Create trigger on user_roles insert
DROP TRIGGER IF EXISTS trg_auto_coupon_for_influencer ON public.user_roles;
CREATE TRIGGER trg_auto_coupon_for_influencer
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_influencer_coupon();
