-- Link pdf_jobs to ai_estimates and add metadata columns
ALTER TABLE public.pdf_jobs 
  ADD COLUMN IF NOT EXISTS ai_estimate_id uuid REFERENCES public.ai_estimates(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS filename text,
  ADD COLUMN IF NOT EXISTS file_url text;

-- Fix potential column name mismatch (docs say userid, app might want user_id)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pdf_jobs' AND column_name='user_id') THEN
    ALTER TABLE public.pdf_jobs ADD COLUMN user_id uuid REFERENCES auth.users(id);
  END IF;
END $$;
