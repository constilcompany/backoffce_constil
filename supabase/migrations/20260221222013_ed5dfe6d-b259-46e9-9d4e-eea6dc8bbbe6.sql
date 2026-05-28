
-- Rename influencer_commission_fixed to influencer_commission_percent
ALTER TABLE public.global_settings 
  RENAME COLUMN influencer_commission_fixed TO influencer_commission_percent;

-- Update the auto_create_influencer_coupon function to reference the new column name
CREATE OR REPLACE FUNCTION public.auto_create_influencer_coupon()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _influencer_name text;
  _coupon_code text;
  _default_discount numeric;
  _counter int := 0;
BEGIN
  IF NEW.role != 'influencer' THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO _influencer_name
  FROM public.profiles WHERE user_id = NEW.user_id;

  SELECT COALESCE(influencer_commission_percent, 10) INTO _default_discount
  FROM public.global_settings LIMIT 1;

  IF _default_discount IS NULL THEN
    _default_discount := 10;
  END IF;

  IF _influencer_name IS NOT NULL AND _influencer_name != '' THEN
    _coupon_code := UPPER(REGEXP_REPLACE(_influencer_name, '[^a-zA-Z0-9]', '', 'g')) || CAST(_default_discount AS int);
  ELSE
    _coupon_code := 'AUTO-' || UPPER(SUBSTRING(NEW.user_id::text FROM 1 FOR 8));
  END IF;

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
$function$;
