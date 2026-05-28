-- Recreating the profiles_with_stats view which was missing from the migration history
-- This view is used by the frontend to display dashboard statistics for influencers/managers.

CREATE OR REPLACE VIEW public.profiles_with_stats AS
SELECT 
  p.id,
  p.user_id,
  p.full_name,
  p.email,
  p.phone,
  p.avatar_url,
  p.bank_name,
  p.bank_account,
  p.payment_method,
  p.company_name,
  p.address,
  p.zip_code,
  p.city,
  p.state,
  p.country,
  p.signup_method,
  p.created_at,
  p.updated_at,
  -- Counts
  (SELECT count(*)::int FROM public.invoices i WHERE i.user_id = p.user_id) as invoice_count,
  (SELECT count(*)::int FROM public.estimates e WHERE e.user_id = p.user_id) as estimate_count,
  (SELECT count(*)::int FROM public.ai_estimates a WHERE a.user_id = p.user_id) as blue_print_count,
  -- Monthly Stats
  (SELECT count(*)::int FROM public.invoices i 
   WHERE i.user_id = p.user_id 
   AND i.created_at >= date_trunc('month', now())) as invoice_in_this_month,
  (SELECT count(*)::int FROM public.estimates e 
   WHERE e.user_id = p.user_id 
   AND e.created_at >= date_trunc('month', now())) as estimates_in_this_month,
  -- Register info (Mocking JSON structure expected by frontend)
  jsonb_build_object(
    'total_invoices', (SELECT COALESCE(sum(total), 0) FROM public.invoices WHERE user_id = p.user_id),
    'total_estimates', (SELECT COALESCE(sum(total), 0) FROM public.estimates WHERE user_id = p.user_id)
  ) as register
FROM public.profiles p;

-- Grant access
GRANT SELECT ON public.profiles_with_stats TO authenticated;
GRANT SELECT ON public.profiles_with_stats TO anon;
