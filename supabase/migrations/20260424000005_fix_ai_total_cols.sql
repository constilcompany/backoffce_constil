-- Extending total column to AI tables to ensure analytics views can aggregate them
ALTER TABLE public.ai_invoices 
  ADD COLUMN IF NOT EXISTS total numeric(15,2) DEFAULT 0.00;

ALTER TABLE public.ai_estimates 
  ADD COLUMN IF NOT EXISTS total numeric(15,2) DEFAULT 0.00;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
