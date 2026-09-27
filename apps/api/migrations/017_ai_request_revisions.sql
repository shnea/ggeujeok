-- A changed assistant configuration is a new generation, not a retry of the old prompt.
DROP INDEX ai_tasks_post_version;
CREATE UNIQUE INDEX ai_tasks_post_version ON ai_tasks(kind,post_id,post_version,settings_revision)
  WHERE kind IN ('summary','tags');
