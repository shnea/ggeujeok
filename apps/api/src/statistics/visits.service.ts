import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../database/database.js';

export const visitDay = (now = new Date()) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

@Injectable()
export class Visits {
  constructor(@Inject(Database) private readonly db: Database) {}

  async record(postId: string, visitorHash: string, referrerHost: string, now = new Date()) {
    const day = visitDay(now);
    return this.db.transaction(async tx => {
      // Serialize a visitor's concurrent tabs so both deduplication and daily uniques are exact.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`visits:${visitorHash}`]);
      const post = await tx.query("SELECT id FROM posts WHERE id=$1 AND status='PUBLIC' FOR SHARE", [postId]);
      if (!post.rowCount) return false;
      const duplicate = await tx.query(`SELECT 1 FROM visit_events WHERE visitor_hash=$1 AND post_id=$2
        AND visited_at>$3::timestamptz-interval '30 minutes' LIMIT 1`, [visitorHash, postId, now]);
      if (duplicate.rowCount) return false;
      const seenToday = await tx.query(`SELECT 1 FROM visit_events WHERE visitor_hash=$1
        AND visited_at>=($2::date::timestamp AT TIME ZONE 'Asia/Seoul') LIMIT 1`, [visitorHash, day]);
      await tx.query('INSERT INTO visit_events(post_id,visitor_hash,referrer_host,visited_at) VALUES($1,$2,$3,$4)', [postId, visitorHash, referrerHost, now]);
      await tx.query(`INSERT INTO visit_days(day,views,visitors) VALUES($1,1,$2) ON CONFLICT(day)
        DO UPDATE SET views=visit_days.views+1,visitors=visit_days.visitors+excluded.visitors`, [day, seenToday.rowCount ? 0 : 1]);
      await tx.query(`INSERT INTO post_visit_days(day,post_id,views) VALUES($1,$2,1) ON CONFLICT(day,post_id)
        DO UPDATE SET views=post_visit_days.views+1`, [day, postId]);
      await tx.query(`INSERT INTO post_visit_totals(post_id,views) VALUES($1,1) ON CONFLICT(post_id)
        DO UPDATE SET views=post_visit_totals.views+1`, [postId]);
      await tx.query(`INSERT INTO referrer_visit_days(day,host,views) VALUES($1,$2,1) ON CONFLICT(day,host)
        DO UPDATE SET views=referrer_visit_days.views+1`, [day, referrerHost]);
      return true;
    });
  }

  async report(days: number) {
    const today = visitDay();
    const [daily, popular, referrers, recent, total] = await Promise.all([
      this.db.query(`SELECT to_char(d.day,'YYYY-MM-DD') AS day,COALESCE(v.views,0)::float8 AS views,COALESCE(v.visitors,0)::float8 AS visitors
        FROM generate_series($1::date-($2::int-1),$1::date,interval '1 day') d(day)
        LEFT JOIN visit_days v ON v.day=d.day ORDER BY d.day`, [today, days]),
      this.db.query(`SELECT p.id,p.title,p.slug,p.status,sum(v.views)::float8 AS views FROM post_visit_days v JOIN posts p ON p.id=v.post_id
        WHERE v.day BETWEEN $1::date-($2::int-1) AND $1::date GROUP BY p.id ORDER BY views DESC,p.id LIMIT 10`, [today, days]),
      this.db.query(`SELECT host,sum(views)::float8 AS views FROM referrer_visit_days WHERE day BETWEEN $1::date-($2::int-1) AND $1::date
        GROUP BY host ORDER BY views DESC,host LIMIT 10`, [today, days]),
      this.db.query(`SELECT v.visited_at AS "visitedAt",p.title,p.id,v.referrer_host AS "referrerHost"
        FROM visit_events v JOIN posts p ON p.id=v.post_id ORDER BY v.visited_at DESC,v.id DESC LIMIT 20`),
      this.db.query('SELECT COALESCE(sum(views),0)::float8 AS views FROM post_visit_totals'),
    ]);
    return { days, timezone: 'Asia/Seoul', totalViews: total.rows[0].views,
      daily: daily.rows, popular: popular.rows, referrers: referrers.rows, recent: recent.rows };
  }

  async prune() {
    await this.db.transaction(async tx => {
      await tx.query("DELETE FROM visit_events WHERE visited_at<now()-interval '30 days'");
      for (const table of ['visit_days', 'post_visit_days', 'referrer_visit_days']) {
        await tx.query(`DELETE FROM ${table} WHERE day<(now() AT TIME ZONE 'Asia/Seoul')::date-interval '13 months'`);
      }
    });
  }
}
