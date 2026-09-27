CREATE TABLE ai_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  data jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  next_comment_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO categories(name,slug) VALUES('루미의 시선','lumi-view') ON CONFLICT(slug) DO NOTHING;

ALTER TABLE posts ADD COLUMN ai_summary text;
ALTER TABLE posts ADD COLUMN ai_summary_version integer;
ALTER TABLE posts ADD COLUMN ai_summary_identity jsonb;
ALTER TABLE posts ADD COLUMN ai_generated boolean NOT NULL DEFAULT false;
ALTER TABLE posts ADD COLUMN ai_identity jsonb;
ALTER TABLE comments ADD COLUMN ai_identity jsonb;
ALTER TABLE comments DROP CONSTRAINT comments_owner_check;
ALTER TABLE comments ADD CONSTRAINT comments_owner_check CHECK (
  (status='DELETED' AND user_id IS NULL AND guest_name IS NULL AND guest_password IS NULL)
  OR (status='VISIBLE' AND (
    (ai_identity IS NOT NULL AND user_id IS NULL AND guest_name IS NULL AND guest_password IS NULL)
    OR (ai_identity IS NULL AND ((user_id IS NOT NULL AND guest_name IS NULL AND guest_password IS NULL)
      OR (user_id IS NULL AND guest_name IS NOT NULL AND guest_password IS NOT NULL)))
  ))
);

CREATE TABLE ai_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN ('summary','tags','comment','article')),
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  post_version integer,
  comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  topic text,
  profile jsonb NOT NULL,
  settings_revision integer NOT NULL,
  priority boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','QUEUED','RUNNING','SUCCEEDED','SKIPPED','FAILED')),
  job_id uuid,
  dispatch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  error_code text,
  execution_started_at timestamptz,
  execution_error text,
  input_hash text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(comment_id)
);
CREATE INDEX ai_tasks_pending ON ai_tasks(state,created_at);
CREATE UNIQUE INDEX ai_tasks_post_version ON ai_tasks(kind,post_id,post_version) WHERE kind IN ('summary','tags');
CREATE INDEX comments_ai_target ON comments(reply_to_id) WHERE ai_identity IS NOT NULL;
