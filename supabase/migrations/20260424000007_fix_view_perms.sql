-- Fixing permissions for the profiles_with_stats view
GRANT ALL ON TABLE public.profiles_with_stats TO postgres;
GRANT ALL ON TABLE public.profiles_with_stats TO service_role;
GRANT SELECT ON TABLE public.profiles_with_stats TO authenticated;
GRANT SELECT ON TABLE public.profiles_with_stats TO anon;

-- In Supabase, if the view references tables with RLS, you might need SECURITY DEFINER complex views or just ensure the user has access to underlying tables.
-- This view uses subqueries which are usually safe if the user has SELECT on underlying tables.
