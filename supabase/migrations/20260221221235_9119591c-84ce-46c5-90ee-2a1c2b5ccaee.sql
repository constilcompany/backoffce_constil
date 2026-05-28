
-- Fix manager coupon RLS: managers can only view/edit coupons where the influencer is in their team
-- Drop existing manager policy
DROP POLICY IF EXISTS "Managers can manage own coupons" ON public.coupons;

-- Manager can SELECT coupons for influencers in their team
CREATE POLICY "Managers can view team influencer coupons"
ON public.coupons
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND influencer_id IN (
    SELECT influencer_id FROM public.manager_influencers WHERE manager_id = auth.uid()
  )
);

-- Manager can UPDATE coupons for influencers in their team (but not change influencer_id)
CREATE POLICY "Managers can update team influencer coupons"
ON public.coupons
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND influencer_id IN (
    SELECT influencer_id FROM public.manager_influencers WHERE manager_id = auth.uid()
  )
);
