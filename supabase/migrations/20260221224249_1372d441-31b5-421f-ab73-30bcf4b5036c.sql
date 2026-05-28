-- Rename manager_override_percent to manager_commission_percent in global_settings
ALTER TABLE public.global_settings
  RENAME COLUMN manager_override_percent TO manager_commission_percent;