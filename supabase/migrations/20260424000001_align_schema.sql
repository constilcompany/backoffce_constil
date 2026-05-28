-- Final schema alignment for Invoices, Estimates and Clients
ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS signature_url text;

ALTER TABLE public.estimates 
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS signature_url text;

ALTER TABLE public.clients 
  ADD COLUMN IF NOT EXISTS observation text;
