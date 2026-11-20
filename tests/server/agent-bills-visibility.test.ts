import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as billGet, PATCH as billPatch, DELETE as billDelete } from '@/app/api/bills/[id]/route';
import { POST as participantPost, PATCH as participantPatch, DELETE as participantDelete } from '@/app/api/participants/route';
import { POST as claimPost, DELETE as claimDelete } from '@/app/api/claims/route';
import { POST as claimBatch } from '@/app/api/claims/batch/route';
import { POST as billsClaim } from '@/app/api/bills/claim/route';
import { GET as billsMine } from '@/app/api/bills/mine/route';
import { generateMetadata } from '@/app/bill/[id]/layout';
import OpengraphImage from '@/app/bill/[id]/opengraph-image';
import TwitterImage from '@/app/bill/[id]/twitter-image';
import { createBill, createUser, db, joinBill, params, request, uuid, type TestBill } from './helpers/db';
import { signInAs, signOut, type TestUser } from './helpers/session';

// G2: a bill that is waiting for approval does not exist for anyone, its own
// creator and the holder of its creator token included, on every ordinary path.

let owner: TestUser;
let unpublished: TestBill;
let published: TestBill;
let guest: { id: string; token: string | null };
let hostRow: string;

const PENDING = { approval_required: true, approved_at: null, approval_expires_at: new Date(Date.now() + 86_400_000).toISOString() };

beforeAll(async () => {
  owner = await createUser('owner', 'Olive Owner');
  unpublished = await createBill({ creator: owner, name: 'Proposed dinner', extra: { ...PENDING, created_via: 'agent' } });
  published = await createBill({ creator: owner, name: 'Live dinner' });
  guest = await joinBill(unpublished.id, { name: 'Early guest' });
  hostRow = unpublished.creatorParticipantId;
});

beforeEach(() => signOut());

const bodyOf = async (res: Response) => ({ status: res.status, body: await res.json() });
const asCreator = (token = unpublished.creatorToken) => ({ 'X-Creator-Token': token });
const state = async (id: string) =>
  (await db().from('bills').select('name, status, approval_required, approved_at, created_via, agent_token_id').eq('id', id).single()).data!;

describe('GET /api/bills/[id]', () => {
  it('answers the same 404 as for a bill that never existed, by id and by short code', async () => {
    const ghost = await bodyOf(await billGet(request('GET', `/api/bills/${uuid()}`), params({ id: uuid() })));
    for (const id of [unpublished.id, unpublished.shortCode]) {
      expect(await bodyOf(await billGet(request('GET', `/api/bills/${id}`), params({ id })))).toEqual(ghost);
      signInAs(owner);
      expect(await bodyOf(await billGet(request('GET', `/api/bills/${id}`, { headers: asCreator() }), params({ id })))).toEqual(ghost);
      signOut();
    }
    expect(ghost.status).toBe(404);
  });

  it('serves a published bill, and the same bill once it is approved', async () => {
    expect((await billGet(request('GET', `/api/bills/${published.id}`), params({ id: published.id }))).status).toBe(200);
    const { id } = await createBill({ creator: owner, extra: { ...PENDING, approved_at: new Date().toISOString() } });
    expect((await billGet(request('GET', `/api/bills/${id}`), params({ id }))).status).toBe(200);
  });
});

describe('PATCH and DELETE /api/bills/[id]', () => {
  it('PATCH is not-found for the creator, by session and by token, and changes nothing', async () => {
    signInAs(owner);
    for (const headers of [{}, asCreator()]) {
      const res = await billPatch(
        request('PATCH', `/api/bills/${unpublished.id}`, { body: { name: 'Renamed', status: 'active' }, headers }),
        params({ id: unpublished.id })
      );
      expect(res.status).toBe(404);
    }
    expect(await state(unpublished.id)).toMatchObject({ name: 'Proposed dinner', approval_required: true, approved_at: null });
  });

  it('DELETE is not-found for the creator, and the bill stays', async () => {
    signInAs(owner);
    for (const headers of [{}, asCreator()]) {
      const res = await billDelete(request('DELETE', `/api/bills/${unpublished.id}`, { headers }), params({ id: unpublished.id }));
      expect(res.status).toBe(404);
    }
    expect((await db().from('bills').select('id').eq('id', unpublished.id)).data).toHaveLength(1);
  });

  it('PATCH { status: "active" } cannot publish a proposal', async () => {
    signInAs(owner);
    await billPatch(request('PATCH', `/api/bills/${unpublished.id}`, { body: { status: 'active' } }), params({ id: unpublished.id }));
    expect((await state(unpublished.id)).approved_at).toBeNull();
  });

  it('PATCH can never write the approval or provenance columns, on any bill', async () => {
    const approved = await createBill({
      creator: owner,
      extra: { ...PENDING, approved_at: new Date().toISOString(), created_via: 'agent' },
    });
    signInAs(owner);
    for (const bill of [published, approved]) {
      const before = await state(bill.id);
      const res = await billPatch(
        request('PATCH', `/api/bills/${bill.id}`, {
          body: {
            name: 'Still fine',
            approval_required: true,
            approved_at: null,
            approval_expires_at: '2030-01-01T00:00:00Z',
            created_via: 'web',
            agent_token_id: uuid(),
          },
        }),
        params({ id: bill.id })
      );
      expect(res.status).toBe(200);
      const text = JSON.stringify(await res.json());
      expect(text).not.toMatch(/approval_|created_via|agent_token_id/);
      expect(await state(bill.id)).toEqual({ ...before, name: 'Still fine' });
    }
  });
});

describe('participants', () => {
  it('POST (joining) is not-found, nameless or named, signed in or not', async () => {
    const ghost = await bodyOf(await participantPost(request('POST', '/api/participants', { body: { bill_id: uuid(), name: 'Zed' } })));
    expect(ghost.status).toBe(404);
    const other = await createUser('joiner');
    for (const user of [null, other]) {
      signInAs(user);
      const res = await participantPost(request('POST', '/api/participants', { body: { bill_id: unpublished.id, name: 'Zed' } }));
      expect(await bodyOf(res)).toEqual(ghost);
    }
    signInAs(owner);
    const nameless = await participantPost(request('POST', '/api/participants', { body: { bill_id: unpublished.id } }));
    expect(nameless.status).toBe(404);
    expect((await db().from('participants').select('id').eq('bill_id', unpublished.id)).data).toHaveLength(2);
  });

  it('PATCH is not-found for the participant themself and for the creator', async () => {
    const asGuest = await participantPatch(
      request('PATCH', '/api/participants', { body: { participant_id: guest.id, payment_status: 'paid' }, headers: { 'X-Participant-Token': guest.token! } })
    );
    expect(asGuest.status).toBe(404);
    signInAs(owner);
    for (const body of [{ participant_id: guest.id, payment_status: 'paid' }, { participant_id: guest.id, custom_amount: 5 }]) {
      const res = await participantPatch(request('PATCH', '/api/participants', { body, headers: asCreator() }));
      expect(res.status).toBe(404);
    }
    expect((await db().from('participants').select('payment_status, custom_amount').eq('id', guest.id).single()).data).toMatchObject({
      custom_amount: null,
    });
  });

  it('DELETE is not-found for the creator, and the participant stays', async () => {
    signInAs(owner);
    const res = await participantDelete(request('DELETE', `/api/participants?participant_id=${guest.id}`, { headers: asCreator() }));
    expect(res.status).toBe(404);
    expect((await db().from('participants').select('id').eq('id', guest.id)).data).toHaveLength(1);
  });
});

describe('claims', () => {
  const claimCount = async () =>
    (await db().from('item_claims').select('id').in('item_id', unpublished.itemIds)).data!.length;

  it('POST answers as if the item were not on the bill, for a participant, the creator token and the session', async () => {
    const ghost = await bodyOf(
      await claimPost(request('POST', '/api/claims', { body: { participant_id: uuid(), item_id: uuid() } }))
    );
    const attempts = [
      { headers: { 'X-Participant-Token': guest.token! }, participant_id: guest.id },
      { headers: asCreator(), participant_id: hostRow },
    ];
    for (const attempt of attempts) {
      const res = await claimPost(
        request('POST', '/api/claims', { body: { participant_id: attempt.participant_id, item_id: unpublished.itemIds[0] }, headers: attempt.headers })
      );
      expect(res.status).toBe(ghost.status);
    }
    signInAs(owner);
    const res = await claimPost(request('POST', '/api/claims', { body: { participant_id: hostRow, item_id: unpublished.itemIds[0] } }));
    expect(res.status).toBe(ghost.status);
    expect(await claimCount()).toBe(0);
  });

  it('DELETE answers as if the item did not exist', async () => {
    await db().from('item_claims').insert({ participant_id: hostRow, item_id: unpublished.itemIds[0], share: 1 });
    signInAs(owner);
    const res = await claimDelete(
      request('DELETE', `/api/claims?participant_id=${hostRow}&item_id=${unpublished.itemIds[0]}`, { headers: asCreator() })
    );
    expect(res.status).toBe(404);
    expect(await claimCount()).toBe(1);
    await db().from('item_claims').delete().eq('participant_id', hostRow);
  });

  it('batch POST is refused and writes nothing', async () => {
    signInAs(owner);
    const res = await claimBatch(
      request('POST', '/api/claims/batch', {
        body: { item_id: unpublished.itemIds[0], entries: [{ participant_id: hostRow, share: 1 }] },
        headers: asCreator(),
      })
    );
    expect(res.status).toBe(400);
    expect(await claimCount()).toBe(0);
  });

  it('still works on a published bill', async () => {
    signInAs(owner);
    const res = await claimPost(
      request('POST', '/api/claims', { body: { participant_id: published.creatorParticipantId, item_id: published.itemIds[0] } })
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/bills/claim', () => {
  it('cannot adopt an unpublished bill with its creator token', async () => {
    const orphan = await createBill({ creator: null, extra: PENDING });
    const adopter = await createUser('adopter');
    signInAs(adopter);
    const res = await billsClaim(
      request('POST', '/api/bills/claim', { body: { claims: [{ bill_id: orphan.id, creator_token: orphan.creatorToken }] } })
    );
    expect(await res.json()).toEqual({ claimed: 0, failed: [orphan.id] });
    expect((await db().from('bills').select('creator_user_id').eq('id', orphan.id).single()).data!.creator_user_id).toBeNull();
  });
});

describe('GET /api/bills/mine', () => {
  it('lists proposals as pending, drops expired ones, and keeps old rows plain', async () => {
    const mine = await createUser('lister');
    const live = await createBill({ creator: mine, name: 'web bill' });
    const pending = await createBill({ creator: mine, name: 'pending', extra: { ...PENDING, created_via: 'agent' } });
    const expired = await createBill({
      creator: mine,
      name: 'expired',
      extra: { ...PENDING, created_via: 'agent', approval_expires_at: new Date(Date.now() - 60_000).toISOString() },
    });
    const approved = await createBill({ creator: mine, name: 'approved', extra: { ...PENDING, created_via: 'agent', approved_at: new Date().toISOString() } });
    signInAs(mine);
    const res = await billsMine();
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; approval: string; created_via: string; approval_expires_at: string | null; name: string }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.has(expired.id)).toBe(false);
    expect(byId.get(live.id)).toMatchObject({ approval: 'none', created_via: 'web', approval_expires_at: null });
    expect(byId.get(pending.id)).toMatchObject({ approval: 'pending', created_via: 'agent', approval_expires_at: PENDING.approval_expires_at.replace('Z', '+00:00') });
    expect(byId.get(approved.id)).toMatchObject({ approval: 'none', created_via: 'agent' });
    expect(Object.keys(byId.get(live.id)!).sort()).toEqual(
      ['approval', 'approval_expires_at', 'created_at', 'created_via', 'id', 'name', 'short_code', 'status', 'subtotal', 'tax', 'tip_amount'].sort()
    );
  });
});

describe('page metadata and share images', () => {
  const titleOf = async (id: string) => {
    const meta = await generateMetadata({ params: Promise.resolve({ id }) });
    return (meta.title as { absolute: string }).absolute;
  };
  const imageBytes = async (render: typeof OpengraphImage, id: string) =>
    Buffer.from(await (await render({ params: Promise.resolve({ id }) })).arrayBuffer());

  it('metadata is the generic one for a proposal, as for a missing bill', async () => {
    expect(await titleOf(unpublished.id)).toBe('Splittr');
    expect(await titleOf(uuid())).toBe('Splittr');
    const fresh = await createBill({ creator: owner, name: 'Fresh dinner' });
    expect(await titleOf(fresh.id)).toBe('Fresh dinner · Splittr');
  });

  it('both share images fall back to the generic card', async () => {
    const generic = await imageBytes(OpengraphImage, uuid());
    expect((await imageBytes(OpengraphImage, unpublished.id)).equals(generic)).toBe(true);
    expect((await imageBytes(TwitterImage, unpublished.id)).equals(generic)).toBe(true);
    const fresh = await createBill({ creator: owner, name: 'Fresh dinner' });
    expect((await imageBytes(OpengraphImage, fresh.id)).equals(generic)).toBe(false);
  });
});
