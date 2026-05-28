
CREATE TABLE public.support_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  company_name text NOT NULL DEFAULT '',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.support_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage support queries"
ON public.support_queries FOR ALL
TO public
USING (has_role(auth.uid(), 'admin'::app_role));
