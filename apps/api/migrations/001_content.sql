CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  slug text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO categories(name, slug) VALUES ('기록', 'notes');

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  content jsonb NOT NULL,
  content_text text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  thumbnail_id uuid,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'PUBLIC', 'PRIVATE')),
  category_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'PUBLIC' OR (category_id IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX posts_public_order ON posts(published_at DESC, id DESC) WHERE status = 'PUBLIC';
CREATE INDEX posts_search ON posts USING gin (content_text gin_trgm_ops) WHERE status = 'PUBLIC';

CREATE TABLE post_drafts (
  post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  base_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE post_tags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_created ON audit_events(created_at);
