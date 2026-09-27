-- Keep names unique without losing their display case or spelling.
ALTER TABLE categories ADD COLUMN normalized_name text
  GENERATED ALWAYS AS (lower(normalize(btrim(name), NFC))) STORED UNIQUE;

-- Draft JSON remains the source of truth. The generated reference also protects
-- concurrent draft saves and category deletes, without maintaining a second value.
ALTER TABLE post_drafts ADD COLUMN category_id uuid
  GENERATED ALWAYS AS ((data->>'categoryId')::uuid) STORED
  REFERENCES categories(id) ON DELETE RESTRICT;
CREATE INDEX post_drafts_category ON post_drafts(category_id);
CREATE INDEX posts_category ON posts(category_id);
