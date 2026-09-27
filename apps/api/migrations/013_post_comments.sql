ALTER TABLE posts ADD COLUMN comments_enabled boolean NOT NULL DEFAULT true;
UPDATE post_drafts SET data=data || '{"commentsEnabled":true}'::jsonb WHERE NOT (data ? 'commentsEnabled');
