-- Add denormalized columns to invoice_items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount jsonb DEFAULT '[]'::jsonb;

-- Add denormalized columns to estimate_items
ALTER TABLE public.estimate_items
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount jsonb DEFAULT '[]'::jsonb;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';