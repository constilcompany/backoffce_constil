-- Add 'user' role for the external customer portal
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'user';