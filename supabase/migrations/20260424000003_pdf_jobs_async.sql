-- Phase 1: Asynchronous PDF Processing Pipeline Schema

-- 1. Create a custom ENUM for job status
DO $$ BEGIN
    CREATE TYPE public.pdf_job_status AS ENUM ('pending', 'processing', 'done', 'fail');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create the pdf_jobs table
CREATE TABLE IF NOT EXISTS public.pdf_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userid UUID REFERENCES auth.users(id) NOT NULL,
  pdf_key TEXT NOT NULL,
  status public.pdf_job_status DEFAULT 'pending' NOT NULL,
  detail JSONB,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  ai_estimate_id UUID REFERENCES public.ai_estimates(id) ON DELETE CASCADE,
  filename TEXT,
  file_url TEXT
);

-- 3. Enable RLS
ALTER TABLE public.pdf_jobs ENABLE ROW LEVEL SECURITY;

-- 4. Set up policies
DROP POLICY IF EXISTS "Users can only insert their own pdf jobs" ON public.pdf_jobs;
CREATE POLICY "Users can only insert their own pdf jobs"
  ON public.pdf_jobs FOR INSERT
  WITH CHECK (auth.uid() = userid);

DROP POLICY IF EXISTS "Users can only view their own pdf jobs" ON public.pdf_jobs;
CREATE POLICY "Users can only view their own pdf jobs"
  ON public.pdf_jobs FOR SELECT
  USING (auth.uid() = userid);

DROP POLICY IF EXISTS "Users can update their own pdf jobs" ON public.pdf_jobs;
CREATE POLICY "Users can update their own pdf jobs"
  ON public.pdf_jobs FOR UPDATE
  USING (auth.uid() = userid);

-- Admins can manage everything
DROP POLICY IF EXISTS "Admins can manage all pdf jobs" ON public.pdf_jobs;
CREATE POLICY "Admins can manage all pdf jobs"
  ON public.pdf_jobs FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));
