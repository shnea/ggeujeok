import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Database } from './database.js';

const database = new Database();
const directory = fileURLToPath(new URL('../../migrations/', import.meta.url));
try {
  await database.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(73701901)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
      const sql = await readFile(`${directory}/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1,$2)', [name, checksum]);
      console.info(`Applied ${name}`);
    }
  });
} finally { await database.end(); }
