ALTER TABLE ad_settings
  ADD COLUMN feed_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN adsense_feed_slot text NOT NULL DEFAULT '',
  ADD COLUMN adsense_feed_layout_key text NOT NULL DEFAULT '';
