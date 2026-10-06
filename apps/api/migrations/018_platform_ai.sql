-- Retain the remote AI execution ID so a restarted worker can read its result.
ALTER TABLE ai_tasks ADD COLUMN ai_job_id uuid;
ALTER TABLE ai_tasks ADD COLUMN ai_request_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Existing post tasks refer to published revisions. New button requests refer to draft revisions.
ALTER TABLE ai_tasks ADD COLUMN manual_request boolean NOT NULL DEFAULT false;
UPDATE ai_tasks SET state='SKIPPED',completed_at=now(),error_code='MANUAL_REQUEST_REQUIRED'
  WHERE kind IN ('summary','tags') AND state NOT IN ('SUCCEEDED','SKIPPED');
DROP INDEX ai_tasks_post_version;
CREATE UNIQUE INDEX ai_tasks_post_version ON ai_tasks(kind,post_id,post_version,settings_revision)
  WHERE kind IN ('summary','tags') AND manual_request;

-- Manually requested text belongs to the editor revision until the author publishes it.
ALTER TABLE post_drafts ADD COLUMN ai_summary text;
ALTER TABLE post_drafts ADD COLUMN ai_summary_version integer;
ALTER TABLE post_drafts ADD COLUMN ai_summary_identity jsonb;
UPDATE post_drafts d SET ai_summary=p.ai_summary,ai_summary_version=d.version,ai_summary_identity=p.ai_summary_identity
  FROM posts p WHERE p.id=d.post_id AND p.ai_summary IS NOT NULL AND p.ai_summary_version=p.version
  AND p.title=d.data->>'title' AND p.content=d.data->'content';
