-- Update handle_new_user trigger so portal self-signups auto-get the 'user' role.
-- We detect "portal" signups via raw_user_meta_data->>'signup_source' = 'portal'.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, email, full_name, signup_method)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'signup_source', 'manual')
  );
  -- Create credits record
  INSERT INTO public.user_credits (user_id, balance)
  VALUES (NEW.id, 0);
  -- Create wallet
  INSERT INTO public.user_credit_wallets (user_id)
  VALUES (NEW.id);
  -- Auto-assign 'user' role for portal self-signups only.
  -- Admin/manager/influencer roles are still assigned by admins via edge functions.
  IF COALESCE(NEW.raw_user_meta_data->>'signup_source', '') = 'portal' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user'::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- Make sure the trigger exists on auth.users (it may already exist; CREATE OR REPLACE the function only).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;