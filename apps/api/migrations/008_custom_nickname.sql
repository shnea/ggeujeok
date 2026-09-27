-- Keep the synchronized account name separate from the optional blog override.
ALTER TABLE users ADD COLUMN custom_nickname text
  CHECK (custom_nickname IS NULL OR length(custom_nickname) BETWEEN 2 AND 30);
