
-- Drop overly permissive policy and restrict to authenticated only (service role bypasses RLS anyway)
DROP POLICY IF EXISTS "Service role manages rate limits" ON public.rate_limits;
-- No policies needed - service role bypasses RLS, anon/authenticated users should never access this table directly
