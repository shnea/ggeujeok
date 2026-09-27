ALTER TABLE users ADD COLUMN nickname text CHECK (length(nickname) BETWEEN 2 AND 30);
ALTER TABLE users ADD COLUMN normalized_nickname text GENERATED ALWAYS AS (lower(normalize(nickname,NFC))) STORED;
CREATE UNIQUE INDEX users_nickname_unique ON users(normalized_nickname) WHERE nickname IS NOT NULL;

CREATE TABLE comments (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  guest_name text,
  guest_password text,
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'VISIBLE' CHECK (status = 'VISIBLE'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL AND guest_name IS NULL AND guest_password IS NULL)
    OR (user_id IS NULL AND guest_name IS NOT NULL AND guest_password IS NOT NULL))
);
CREATE INDEX comments_post_order ON comments(post_id,created_at,id);
CREATE INDEX comments_user_order ON comments(user_id,created_at DESC,id DESC);

CREATE TABLE post_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id,user_id)
);
CREATE INDEX post_likes_user_order ON post_likes(user_id,created_at DESC,id DESC);

-- Each row retains at most 60 successful actions in the rolling window.
CREATE TABLE activity_limits (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('comment','like')),
  events timestamptz[] NOT NULL DEFAULT '{}',
  PRIMARY KEY(user_id,action)
);

CREATE TABLE guest_clients (
  token_hash text PRIMARY KEY,
  challenge_events timestamptz[] NOT NULL DEFAULT '{}',
  comment_events timestamptz[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_clients_updated ON guest_clients(updated_at);
CREATE TABLE comment_captchas (
  id uuid PRIMARY KEY,
  client_hash text NOT NULL REFERENCES guest_clients(token_hash) ON DELETE CASCADE,
  answer_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX comment_captchas_client ON comment_captchas(client_hash);
CREATE INDEX comment_captchas_expiry ON comment_captchas(expires_at);
