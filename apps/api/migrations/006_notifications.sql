CREATE TABLE notification_events (
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('COMMENT','REPLY')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_code text,
  PRIMARY KEY(comment_id,recipient_id)
);
CREATE INDEX notification_events_pending ON notification_events(next_attempt_at) WHERE processed_at IS NULL AND attempts < 5;
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('COMMENT','REPLY')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  UNIQUE(comment_id,recipient_id)
);
CREATE INDEX notifications_recipient_order ON notifications(recipient_id,created_at DESC,id DESC);
CREATE INDEX notifications_expiry ON notifications(created_at);
