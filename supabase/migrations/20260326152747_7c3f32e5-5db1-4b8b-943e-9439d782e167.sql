
CREATE POLICY "Admins can update support queries"
ON public.support_queries FOR UPDATE
TO public
USING (has_role(auth.uid(), 'admin'::app_role));
