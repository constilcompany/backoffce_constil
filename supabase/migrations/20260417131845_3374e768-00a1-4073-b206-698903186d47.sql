
-- Drop the over-broad public SELECT policies that triggered the listing warning
DROP POLICY IF EXISTS "Public read company logos" ON storage.objects;
DROP POLICY IF EXISTS "Public read document logos" ON storage.objects;

-- Restrict SELECT (listing) on public buckets to the owner's folder only.
-- Direct file URLs still work because the bucket is marked public,
-- which goes through the storage CDN and bypasses object-level RLS.
CREATE POLICY "Users list own files in public buckets" ON storage.objects
  FOR SELECT USING (
    bucket_id IN ('company-logos','document-logos')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
