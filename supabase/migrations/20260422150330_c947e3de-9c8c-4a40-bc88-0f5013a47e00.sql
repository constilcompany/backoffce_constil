-- Create custom ENUM type for PDF job status
DO $$ BEGIN
  CREATE TYPE public.pdf_job_status AS ENUM ('pending', 'processing', 'done', 'fail');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create pdf_jobs table
CREATE TABLE IF NOT EXISTS public.pdf_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  userid UUID NOT NULL,
  pdf_key TEXT NOT NULL,
  status public.pdf_job_status NOT NULL DEFAULT 'pending',
  detail JSONB,
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_pdf_jobs_userid ON public.pdf_jobs(userid);
CREATE INDEX IF NOT EXISTS idx_pdf_jobs_status ON public.pdf_jobs(status);
CREATE INDEX IF NOT EXISTS idx_pdf_jobs_created_at ON public.pdf_jobs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.pdf_jobs ENABLE ROW LEVEL SECURITY;

-- RLS: Users can insert their own jobs
CREATE POLICY "Users can insert own pdf jobs"
ON public.pdf_jobs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = userid);

-- RLS: Users can view their own jobs
CREATE POLICY "Users can view own pdf jobs"
ON public.pdf_jobs
FOR SELECT
TO authenticated
USING (auth.uid() = userid);

-- RLS: Users can update their own jobs (so the frontend can also patch if needed; backend uses service role)
CREATE POLICY "Users can update own pdf jobs"
ON public.pdf_jobs
FOR UPDATE
TO authenticated
USING (auth.uid() = userid)
WITH CHECK (auth.uid() = userid);

-- RLS: Admins can manage all pdf jobs
CREATE POLICY "Admins can manage all pdf jobs"
ON public.pdf_jobs
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));