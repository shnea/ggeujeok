ALTER TABLE posts ADD COLUMN ads_enabled boolean NOT NULL DEFAULT true;
UPDATE post_drafts SET data=data || '{"adsEnabled":true}'::jsonb WHERE NOT (data ? 'adsEnabled');
