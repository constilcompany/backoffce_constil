-- Add default auth.uid() and foreign key references to user_id columns
-- This ensures records are automatically associated with the correct user and linked to the auth system.

-- 1. Taxes
ALTER TABLE public.taxes ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.taxes DROP CONSTRAINT IF EXISTS taxes_user_id_fkey;
ALTER TABLE public.taxes ADD CONSTRAINT taxes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

-- 2. Discounts
ALTER TABLE public.discounts ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.discounts DROP CONSTRAINT IF EXISTS discounts_user_id_fkey;
ALTER TABLE public.discounts ADD CONSTRAINT discounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

-- 3. Others for consistency
ALTER TABLE public.products ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.clients ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.invoices ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.estimates ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.ai_invoices ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.ai_estimates ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.invoice_mails ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.estimate_mails ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.invoice_template_locks ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.estimate_template_locks ALTER COLUMN user_id SET DEFAULT auth.uid();
