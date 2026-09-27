import type { Database } from '../database/database.js';

// The platform's public nickname is given_name, never the full name or email.
export function platformNickname(profile: unknown) {
  if (!profile || typeof profile !== 'object' || !('given_name' in profile)) return null;
  return typeof profile.given_name === 'string' ? profile.given_name.trim() || null : null;
}

// Call only after OIDC issuer and subject validation.
export async function syncPlatformUser(db: Database, issuer: string, subject: string, nickname: string) {
  const result = await db.query(`INSERT INTO users(issuer,subject,display_name,nickname) VALUES($1,$2,$3,$3)
    ON CONFLICT(issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name,nickname=EXCLUDED.nickname
    RETURNING id`, [issuer, subject, nickname]);
  return result.rows[0].id as string;
}
