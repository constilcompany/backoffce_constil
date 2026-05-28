ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS document_url text;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS document_url text;
NOTIFY pgrst, 'reload schema';