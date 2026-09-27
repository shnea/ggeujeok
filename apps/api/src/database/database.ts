import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import pg, { type PoolClient } from 'pg';
import { config } from '../config.js';

@Injectable()
export class Database extends pg.Pool implements OnApplicationShutdown {
  constructor() {
    super({
      ...(config.DATABASE_URL ? { connectionString: config.DATABASE_URL } : {
        host: config.PGHOST, port: config.PGPORT, database: config.PGDATABASE,
        user: config.PGUSER, password: config.PGPASSWORD,
      }),
      max: 10, connectionTimeoutMillis: 5_000, statement_timeout: 15_000,
    });
    this.on('error', () => console.error('Database connection interrupted'));
  }

  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async onApplicationShutdown() { await this.end(); }
}

@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
