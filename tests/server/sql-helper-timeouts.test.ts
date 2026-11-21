import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { SQL_LOCK_TIMEOUT_MS, sql } from './helpers/db';

describe('sql() helper', () => {
  it('fails with a clear lock-timeout error instead of waiting forever behind another connection', async () => {
    const holder = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query('lock table public.bills in access exclusive mode');
      const started = Date.now();
      await expect(sql('select count(*) from public.bills')).rejects.toThrow(/lock timeout/);
      expect(Date.now() - started).toBeLessThan(SQL_LOCK_TIMEOUT_MS + 4_000);
    } finally {
      await holder.query('rollback').catch(() => {});
      await holder.end();
    }
    // and it works again once the lock is gone
    expect(await sql('select 1 as one')).toEqual([{ one: 1 }]);
  });
});
