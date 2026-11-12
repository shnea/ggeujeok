CREATE TABLE assistant_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  can_write boolean NOT NULL,
  can_publish boolean NOT NULL,
  can_delete boolean NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE assistant_post_requests (
  id text PRIMARY KEY,
  input_hash text NOT NULL,
  post_id uuid REFERENCES posts(id) ON DELETE SET NULL
);

ALTER TABLE audit_events ADD COLUMN assistant_key_id uuid;
ALTER TABLE audit_events ADD COLUMN assistant_name text;
ALTER TABLE posts ADD COLUMN next_review_at timestamptz;
ALTER TABLE posts ADD COLUMN last_reviewed_at timestamptz;
ALTER TABLE posts ADD COLUMN review_source text;
ALTER TABLE comments ADD COLUMN assistant_reviewed_at timestamptz;
ALTER TABLE activity_limits DROP CONSTRAINT activity_limits_action_check;
ALTER TABLE activity_limits ADD CHECK (action IN ('comment','assistant_comment','like'));
