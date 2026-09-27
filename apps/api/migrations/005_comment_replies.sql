ALTER TABLE comments ADD COLUMN parent_id uuid;
ALTER TABLE comments ADD COLUMN reply_to_id uuid;
ALTER TABLE comments ADD CONSTRAINT comments_id_post_unique UNIQUE(id,post_id);
ALTER TABLE comments ADD CONSTRAINT comments_parent_post_fk
  FOREIGN KEY(parent_id,post_id) REFERENCES comments(id,post_id) ON DELETE CASCADE;
ALTER TABLE comments ADD CONSTRAINT comments_reply_target_post_fk
  FOREIGN KEY(reply_to_id,post_id) REFERENCES comments(id,post_id);
ALTER TABLE comments ADD CONSTRAINT comments_not_own_parent CHECK (parent_id IS DISTINCT FROM id);
ALTER TABLE comments DROP CONSTRAINT comments_status_check;
ALTER TABLE comments ADD CONSTRAINT comments_status_check CHECK (status IN ('VISIBLE','DELETED'));
ALTER TABLE comments DROP CONSTRAINT comments_check;
ALTER TABLE comments ADD CONSTRAINT comments_owner_check CHECK (
  (status='DELETED' AND user_id IS NULL AND guest_name IS NULL AND guest_password IS NULL)
  OR (status='VISIBLE' AND ((user_id IS NOT NULL AND guest_name IS NULL AND guest_password IS NULL)
    OR (user_id IS NULL AND guest_name IS NOT NULL AND guest_password IS NOT NULL)))
);
CREATE INDEX comments_parent_order ON comments(parent_id,created_at,id);
