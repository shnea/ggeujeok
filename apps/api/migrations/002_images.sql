CREATE TABLE image_uploads (
  id uuid PRIMARY KEY,
  post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL REFERENCES users(id),
  project_id text NOT NULL,
  environment_id text NOT NULL,
  credential_hash text NOT NULL,
  original_name text NOT NULL,
  size integer NOT NULL CHECK(size BETWEEN 1 AND 20971520),
  sha256 text NOT NULL,
  received integer NOT NULL DEFAULT 0,
  media_type text,
  file_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX image_uploads_pending ON image_uploads(owner_id, updated_at) WHERE file_id IS NULL;

CREATE TABLE post_file_refs (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES image_uploads(file_id),
  source text NOT NULL CHECK(source IN ('DRAFT','PUBLISHED')),
  PRIMARY KEY(post_id,file_id,source)
);
CREATE INDEX post_file_refs_file ON post_file_refs(file_id);
