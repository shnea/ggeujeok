-- Null retains the environment value for settings saved before this migration.
ALTER TABLE ad_settings
  ADD COLUMN provider text NOT NULL DEFAULT 'adsense' CHECK (provider IN ('adsense','adfit')),
  ADD COLUMN adsense_client_id text,
  ADD COLUMN adsense_post_slot text,
  ADD COLUMN adsense_sidebar_slot text,
  ADD COLUMN adsense_inline_slot text,
  ADD COLUMN adfit jsonb;
