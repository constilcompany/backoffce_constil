
-- Rate limits only accessed by service role in edge functions - add permissive policy for service role
CREATE POLICY "Service role manages rate limits" ON public.rate_limits
  FOR ALL USING (true);
