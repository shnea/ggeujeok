CREATE TABLE visit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  visitor_hash char(64) NOT NULL,
  referrer_host varchar(253) NOT NULL,
  visited_at timestamptz NOT NULL
);
CREATE INDEX visit_events_visitor ON visit_events(visitor_hash, visited_at DESC);
CREATE INDEX visit_events_time ON visit_events(visited_at);

CREATE TABLE visit_days (
  day date PRIMARY KEY,
  views bigint NOT NULL DEFAULT 0,
  visitors bigint NOT NULL DEFAULT 0
);
CREATE TABLE post_visit_days (
  day date NOT NULL,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  views bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(day, post_id)
);
CREATE TABLE post_visit_totals (
  post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  views bigint NOT NULL DEFAULT 0
);
CREATE TABLE referrer_visit_days (
  day date NOT NULL,
  host varchar(253) NOT NULL,
  views bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(day, host)
);
