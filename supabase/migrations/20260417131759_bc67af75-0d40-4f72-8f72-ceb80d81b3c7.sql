
-- INJECTED BASE TABLES
CREATE TABLE IF NOT EXISTS public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id), name text NOT NULL, description text, price numeric(10,2) DEFAULT 0.00, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id), name text NOT NULL, email text, phone text, address text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id), client_id uuid REFERENCES public.clients(id), invoice_number text, status text DEFAULT 'draft', created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.estimates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id), client_id uuid REFERENCES public.clients(id), estimate_number text, status text DEFAULT 'pending', created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.invoice_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid REFERENCES public.invoices(id), name text, quantity integer DEFAULT 1, price numeric(10,2) DEFAULT 0.00);
CREATE TABLE IF NOT EXISTS public.estimate_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), estimate_id uuid REFERENCES public.estimates(id), name text, quantity integer DEFAULT 1, price numeric(10,2) DEFAULT 0.00);

-- =========================================
-- 1. PROFILE EXTENSIONS
-- =========================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city text DEFAULT '',
  ADD COLUMN IF NOT EXISTS state text DEFAULT '',
  ADD COLUMN IF NOT EXISTS country text DEFAULT '',
  ADD COLUMN IF NOT EXISTS signup_method text DEFAULT 'manual';

-- =========================================
-- 2. COMPANY PROFILE + LEGAL INFO
-- =========================================
CREATE TABLE IF NOT EXISTS public.company_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  company_legal_name text NOT NULL,
  industry text,
  website text,
  company_email text NOT NULL,
  company_phone text,
  address text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own company profile" ON public.company_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all company profiles" ON public.company_profiles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_company_profiles_updated
  BEFORE UPDATE ON public.company_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.company_legal_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_profile_id uuid NOT NULL UNIQUE REFERENCES public.company_profiles(id) ON DELETE CASCADE,
  legal_business_name text NOT NULL,
  tax_id_number text,
  legal_address text,
  business_type smallint NOT NULL DEFAULT 1, -- 1=not_sure, 2=other, 3=none
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_legal_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own legal info" ON public.company_legal_info
  FOR ALL USING (
    company_profile_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  ) WITH CHECK (
    company_profile_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  );
CREATE POLICY "Admins manage all legal info" ON public.company_legal_info
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_company_legal_info_updated
  BEFORE UPDATE ON public.company_legal_info
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =========================================
-- 3. TAX & DISCOUNT CATALOGS
-- =========================================
CREATE TABLE IF NOT EXISTS public.taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  rate numeric(6,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own taxes" ON public.taxes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all taxes" ON public.taxes
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  rate numeric(6,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own discounts" ON public.discounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all discounts" ON public.discounts
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- =========================================
-- 4. PRODUCTS – add ref + extra_info
-- =========================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ref text,
  ADD COLUMN IF NOT EXISTS extra_info text;

-- Auto-generate ref like PRD-XXXXXXXX
CREATE OR REPLACE FUNCTION public.set_product_ref()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ref IS NULL OR NEW.ref = '' THEN
    NEW.ref := 'PRD-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 8));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_products_set_ref ON public.products;
CREATE TRIGGER trg_products_set_ref
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_product_ref();

-- Backfill refs for existing rows
UPDATE public.products SET ref = 'PRD-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 8))
  WHERE ref IS NULL OR ref = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_ref_unique ON public.products(ref);

-- =========================================
-- 5. INVOICE / ESTIMATE EXTRAS
-- =========================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_terms smallint,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS signature_url text,
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS template_number smallint;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS payment_terms smallint,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS signature_url text,
  ADD COLUMN IF NOT EXISTS estimate_date date,
  ADD COLUMN IF NOT EXISTS template_number smallint;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS price numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_key boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_key boolean NOT NULL DEFAULT false;

ALTER TABLE public.estimate_items
  ADD COLUMN IF NOT EXISTS price numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_key boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_key boolean NOT NULL DEFAULT false;

-- =========================================
-- 6. ITEM ↔ TAX/DISCOUNT JUNCTION TABLES
-- =========================================
CREATE TABLE IF NOT EXISTS public.invoice_item_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid NOT NULL REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  tax_id uuid NOT NULL REFERENCES public.taxes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_item_id, tax_id)
);
ALTER TABLE public.invoice_item_taxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own invoice item taxes" ON public.invoice_item_taxes
  FOR ALL USING (
    invoice_item_id IN (
      SELECT ii.id FROM public.invoice_items ii
      JOIN public.invoices i ON i.id = ii.invoice_id
      WHERE i.user_id = auth.uid()
    )
  ) WITH CHECK (
    invoice_item_id IN (
      SELECT ii.id FROM public.invoice_items ii
      JOIN public.invoices i ON i.id = ii.invoice_id
      WHERE i.user_id = auth.uid()
    )
  );
CREATE POLICY "Admins manage all invoice item taxes" ON public.invoice_item_taxes
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.invoice_item_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid NOT NULL REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  discount_id uuid NOT NULL REFERENCES public.discounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_item_id, discount_id)
);
ALTER TABLE public.invoice_item_discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own invoice item discounts" ON public.invoice_item_discounts
  FOR ALL USING (
    invoice_item_id IN (
      SELECT ii.id FROM public.invoice_items ii
      JOIN public.invoices i ON i.id = ii.invoice_id
      WHERE i.user_id = auth.uid()
    )
  ) WITH CHECK (
    invoice_item_id IN (
      SELECT ii.id FROM public.invoice_items ii
      JOIN public.invoices i ON i.id = ii.invoice_id
      WHERE i.user_id = auth.uid()
    )
  );
CREATE POLICY "Admins manage all invoice item discounts" ON public.invoice_item_discounts
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.estimate_item_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_item_id uuid NOT NULL REFERENCES public.estimate_items(id) ON DELETE CASCADE,
  tax_id uuid NOT NULL REFERENCES public.taxes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(estimate_item_id, tax_id)
);
ALTER TABLE public.estimate_item_taxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimate item taxes" ON public.estimate_item_taxes
  FOR ALL USING (
    estimate_item_id IN (
      SELECT ei.id FROM public.estimate_items ei
      JOIN public.estimates e ON e.id = ei.estimate_id
      WHERE e.user_id = auth.uid()
    )
  ) WITH CHECK (
    estimate_item_id IN (
      SELECT ei.id FROM public.estimate_items ei
      JOIN public.estimates e ON e.id = ei.estimate_id
      WHERE e.user_id = auth.uid()
    )
  );
CREATE POLICY "Admins manage all estimate item taxes" ON public.estimate_item_taxes
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.estimate_item_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_item_id uuid NOT NULL REFERENCES public.estimate_items(id) ON DELETE CASCADE,
  discount_id uuid NOT NULL REFERENCES public.discounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(estimate_item_id, discount_id)
);
ALTER TABLE public.estimate_item_discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimate item discounts" ON public.estimate_item_discounts
  FOR ALL USING (
    estimate_item_id IN (
      SELECT ei.id FROM public.estimate_items ei
      JOIN public.estimates e ON e.id = ei.estimate_id
      WHERE e.user_id = auth.uid()
    )
  ) WITH CHECK (
    estimate_item_id IN (
      SELECT ei.id FROM public.estimate_items ei
      JOIN public.estimates e ON e.id = ei.estimate_id
      WHERE e.user_id = auth.uid()
    )
  );
CREATE POLICY "Admins manage all estimate item discounts" ON public.estimate_item_discounts
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- =========================================
-- 7. PDF + MAIL HISTORY
-- =========================================
CREATE TABLE IF NOT EXISTS public.invoice_pdfs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  pdf_url text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_pdfs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own invoice pdfs" ON public.invoice_pdfs
  FOR ALL USING (invoice_id IN (SELECT id FROM public.invoices WHERE user_id = auth.uid()))
  WITH CHECK (invoice_id IN (SELECT id FROM public.invoices WHERE user_id = auth.uid()));
CREATE POLICY "Admins manage all invoice pdfs" ON public.invoice_pdfs
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.estimate_pdfs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  pdf_url text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.estimate_pdfs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimate pdfs" ON public.estimate_pdfs
  FOR ALL USING (estimate_id IN (SELECT id FROM public.estimates WHERE user_id = auth.uid()))
  WITH CHECK (estimate_id IN (SELECT id FROM public.estimates WHERE user_id = auth.uid()));
CREATE POLICY "Admins manage all estimate pdfs" ON public.estimate_pdfs
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.invoice_mails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  client_ids uuid[] NOT NULL DEFAULT '{}',
  recipient_emails text[] NOT NULL DEFAULT '{}',
  file_url text,
  send_copy boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_mails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own invoice mails" ON public.invoice_mails
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all invoice mails" ON public.invoice_mails
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.estimate_mails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  estimate_id uuid REFERENCES public.estimates(id) ON DELETE SET NULL,
  client_ids uuid[] NOT NULL DEFAULT '{}',
  recipient_emails text[] NOT NULL DEFAULT '{}',
  file_url text,
  send_copy boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.estimate_mails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimate mails" ON public.estimate_mails
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all estimate mails" ON public.estimate_mails
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- =========================================
-- 8. TEMPLATE LOCKS
-- =========================================
CREATE TABLE IF NOT EXISTS public.invoice_template_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.invoices(id) ON DELETE CASCADE,
  template_number smallint NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_template_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own invoice template locks" ON public.invoice_template_locks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all invoice template locks" ON public.invoice_template_locks
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.estimate_template_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  estimate_id uuid NOT NULL UNIQUE REFERENCES public.estimates(id) ON DELETE CASCADE,
  template_number smallint NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.estimate_template_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimate template locks" ON public.estimate_template_locks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all estimate template locks" ON public.estimate_template_locks
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- =========================================
-- 9. AI INVOICES + AI ESTIMATES
-- =========================================
CREATE TABLE IF NOT EXISTS public.ai_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  name text NOT NULL,
  address text,
  description text,
  input_pdf_url text,
  output_pdf_url text,
  output_json jsonb,
  output_markdown text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own ai invoices" ON public.ai_invoices;
DROP POLICY IF EXISTS "Admins manage all ai invoices" ON public.ai_invoices;
CREATE POLICY "Users manage own ai invoices" ON public.ai_invoices
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all ai invoices" ON public.ai_invoices
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.ai_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  name text NOT NULL,
  address text,
  description text,
  input_pdf_url text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_estimates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own ai estimates" ON public.ai_estimates;
DROP POLICY IF EXISTS "Admins manage all ai estimates" ON public.ai_estimates;
CREATE POLICY "Users manage own ai estimates" ON public.ai_estimates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all ai estimates" ON public.ai_estimates
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.ai_estimate_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_estimate_id uuid NOT NULL REFERENCES public.ai_estimates(id) ON DELETE CASCADE,
  page_number int NOT NULL,
  extracted_page_pdf_url text,
  output_pdf_url text,
  output_json jsonb,
  output_markdown text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_estimate_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ai estimate results" ON public.ai_estimate_results
  FOR ALL USING (
    ai_estimate_id IN (SELECT id FROM public.ai_estimates WHERE user_id = auth.uid())
  ) WITH CHECK (
    ai_estimate_id IN (SELECT id FROM public.ai_estimates WHERE user_id = auth.uid())
  );
CREATE POLICY "Admins manage all ai estimate results" ON public.ai_estimate_results
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- =========================================
-- 10. STORAGE BUCKETS
-- =========================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('company-logos', 'company-logos', true),
  ('document-logos', 'document-logos', true),
  ('signatures', 'signatures', false),
  ('generated-pdfs', 'generated-pdfs', false),
  ('ai-inputs', 'ai-inputs', false),
  ('ai-outputs', 'ai-outputs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read company logos" ON storage.objects;
DROP POLICY IF EXISTS "Public read document logos" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own files" ON storage.objects;
DROP POLICY IF EXISTS "Users update own files" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own files" ON storage.objects;
DROP POLICY IF EXISTS "Users read own private files" ON storage.objects;

-- Public read for the public buckets
CREATE POLICY "Public read company logos" ON storage.objects
  FOR SELECT USING (bucket_id = 'company-logos');
CREATE POLICY "Public read document logos" ON storage.objects
  FOR SELECT USING (bucket_id = 'document-logos');

-- Per-user folder write/read for all 6 buckets (folder = user_id)
CREATE POLICY "Users upload own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id IN ('company-logos','document-logos','signatures','generated-pdfs','ai-inputs','ai-outputs')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "Users update own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id IN ('company-logos','document-logos','signatures','generated-pdfs','ai-inputs','ai-outputs')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "Users delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id IN ('company-logos','document-logos','signatures','generated-pdfs','ai-inputs','ai-outputs')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "Users read own private files" ON storage.objects
  FOR SELECT USING (
    bucket_id IN ('signatures','generated-pdfs','ai-inputs','ai-outputs')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
