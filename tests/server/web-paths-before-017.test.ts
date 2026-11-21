import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as billGet, PATCH as billPatch, DELETE as billDelete } from '@/app/api/bills/[id]/route';
import { POST as participantPost, PATCH as participantPatch, DELETE as participantDelete } from '@/app/api/participants/route';
import { POST as claimPost, DELETE as claimDelete } from '@/app/api/claims/route';
import { POST as claimBatch } from '@/app/api/claims/batch/route';
import { GET as billsMine } from '@/app/api/bills/mine/route';
import { generateMetadata } from '@/app/bill/[id]/layout';
import OpengraphImage from '@/app/bill/[id]/opengraph-image';
import { createBill, createUser, db, joinBill, params, request, uuid } from './helpers/db';
import { signInAs, signOut, type TestUser } from './helpers/session';

// Production does not have migration 017 yet, and the web app has to keep
// working there after a deploy. Nothing in this file names a column or table
// that 017 adds, so it must pass against a database holding migrations up to
// 016 only as well as the full one (see "Both database states" in
// docs/specs/mcp-implementation.md).

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser('owner', 'Olive Owner');
});
beforeEach(() => signOut());

describe('ordinary bills on the web paths', () => {
  it('GET by id and by short code, PATCH, and DELETE', async () => {
    const bill = await createBill({ creator: owner, name: 'Live dinner' });
    for (const id of [bill.id, bill.shortCode]) {
      const res = await billGet(request('GET', `/api/bills/${id}`), params({ id }));
      expect(res.status).toBe(200);
      expect((await res.json()).name).toBe('Live dinner');
    }
    signInAs(owner);
    const patched = await billPatch(request('PATCH', `/api/bills/${bill.id}`, { body: { name: 'Renamed' } }), params({ id: bill.id }));
    expect(patched.status).toBe(200);
    expect((await db().from('bills').select('name').eq('id', bill.id).single()).data!.name).toBe('Renamed');
    const deleted = await billDelete(request('DELETE', `/api/bills/${bill.id}`), params({ id: bill.id }));
    expect(deleted.status).toBe(200);
    expect((await db().from('bills').select('id').eq('id', bill.id)).data).toHaveLength(0);
  });

  it('participants: join, update, remove', async () => {
    const bill = await createBill({ creator: owner });
    const joined = await participantPost(request('POST', '/api/participants', { body: { bill_id: bill.id, name: 'Zed' } }));
    expect(joined.status).toBeLessThan(300);
    const guest = await joinBill(bill.id, { name: 'Pat' });
    signInAs(owner);
    const headers = { 'X-Creator-Token': bill.creatorToken };
    const patched = await participantPatch(request('PATCH', '/api/participants', { body: { participant_id: guest.id, payment_status: 'paid' }, headers }));
    expect(patched.status).toBe(200);
    const removed = await participantDelete(request('DELETE', `/api/participants?participant_id=${guest.id}`, { headers }));
    expect(removed.status).toBe(200);
  });

  it('claims: single, batch, delete', async () => {
    const bill = await createBill({ creator: owner });
    const guest = await joinBill(bill.id, { name: 'Pat' });
    const asGuest = { 'X-Participant-Token': guest.token! };
    const claimed = await claimPost(request('POST', '/api/claims', { body: { participant_id: guest.id, item_id: bill.itemIds[0] }, headers: asGuest }));
    expect(claimed.status).toBe(200);
    const removed = await claimDelete(request('DELETE', `/api/claims?participant_id=${guest.id}&item_id=${bill.itemIds[0]}`, { headers: asGuest }));
    expect(removed.status).toBe(200);
    signInAs(owner);
    const batch = await claimBatch(
      request('POST', '/api/claims/batch', {
        body: { item_id: bill.itemIds[1], entries: [{ participant_id: bill.creatorParticipantId, share: 1 }] },
        headers: { 'X-Creator-Token': bill.creatorToken },
      })
    );
    expect(batch.status).toBe(200);
  });

  it('bills/mine lists the bill as an ordinary one', async () => {
    const mine = await createUser('lister');
    const bill = await createBill({ creator: mine, name: 'web bill' });
    signInAs(mine);
    const res = await billsMine();
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; approval: string; created_via: string; approval_expires_at: string | null }[];
    expect(rows.find((r) => r.id === bill.id)).toMatchObject({ approval: 'none', created_via: 'web', approval_expires_at: null });
  });

  it('page metadata and the share image carry the bill name', async () => {
    const bill = await createBill({ creator: owner, name: 'Fresh dinner' });
    const meta = await generateMetadata({ params: Promise.resolve({ id: bill.id }) });
    expect((meta.title as { absolute: string }).absolute).toBe('Fresh dinner · Splittr');
    const bytes = async (id: string) => Buffer.from(await (await OpengraphImage({ params: Promise.resolve({ id }) })).arrayBuffer());
    expect((await bytes(bill.id)).equals(await bytes(uuid()))).toBe(false);
  });
});
