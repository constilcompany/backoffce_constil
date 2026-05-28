-- Add alias columns to invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS logo text,
  ADD COLUMN IF NOT EXISTS signature text,
  ADD COLUMN IF NOT EXISTS total_amount numeric;

-- Add alias columns to estimates
ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS logo text,
  ADD COLUMN IF NOT EXISTS signature text,
  ADD COLUMN IF NOT EXISTS total_amount numeric;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';