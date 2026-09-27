ALTER TABLE image_uploads ADD COLUMN unreferenced_since timestamptz;
ALTER TABLE image_uploads ADD COLUMN deleting_at timestamptz;
CREATE INDEX image_uploads_cleanup ON image_uploads(unreferenced_since) WHERE deleting_at IS NULL;
