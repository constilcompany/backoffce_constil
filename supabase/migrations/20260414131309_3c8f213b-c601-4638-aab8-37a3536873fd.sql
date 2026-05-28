
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS zip_code text DEFAULT '';
