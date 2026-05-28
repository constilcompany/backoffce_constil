-- Add missing columns to Invoices and Estimates to match App requirements
ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS total numeric(15,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS subtotal numeric(15,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(15,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS tax_percent numeric(5,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.estimates 
  ADD COLUMN IF NOT EXISTS total numeric(15,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS subtotal numeric(15,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(15,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS tax_percent numeric(5,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS estimate_type text DEFAULT 'estimate';

-- Sync total with total_amount if one is null
UPDATE public.invoices SET total = total_amount WHERE total = 0 AND total_amount != 0;
UPDATE public.estimates SET total = total_amount WHERE total = 0 AND total_amount != 0;
