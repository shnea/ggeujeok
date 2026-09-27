-- Nicknames belong to the platform; account identity remains (issuer, subject).
DROP INDEX users_nickname_unique;
ALTER TABLE users DROP COLUMN normalized_nickname;
ALTER TABLE users DROP CONSTRAINT users_nickname_check;
ALTER TABLE users ADD CONSTRAINT users_nickname_check CHECK (nickname IS NULL OR length(btrim(nickname)) > 0);
