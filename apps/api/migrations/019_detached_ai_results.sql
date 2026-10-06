-- Requests and remote-result collection survive editor navigation and worker restarts.
ALTER TABLE ai_tasks ADD COLUMN input_snapshot jsonb;
ALTER TABLE ai_tasks ADD COLUMN result_check_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX ai_tasks_result_check ON ai_tasks(result_check_at) WHERE state='RUNNING';

-- AI metadata has its own revision; delivery must not conflict with saving the article body.
ALTER TABLE post_drafts ADD COLUMN ai_tags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE post_drafts ADD COLUMN ai_revision integer NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN ai_tags jsonb NOT NULL DEFAULT '[]';

DROP INDEX ai_tasks_post_version;
-- The post row lock serializes new requests; older accepted tasks may coexist until collected.
CREATE INDEX ai_tasks_post_active ON ai_tasks(kind,post_id)
  WHERE manual_request AND kind IN ('summary','tags') AND
    (state IN ('PENDING','QUEUED','RUNNING') OR
      (state='FAILED' AND execution_started_at IS NOT NULL AND execution_error IS NULL));
